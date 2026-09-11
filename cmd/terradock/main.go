package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/RenzoAL7/TerraDock/internal/server"
	"github.com/RenzoAL7/TerraDock/internal/workspace"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	port := flag.Int("port", 7331, "HTTP port on 127.0.0.1")
	root := flag.String("root", ".", "Allowed root directory for local projects")
	assets := flag.String("assets", "web/dist", "Directory containing built frontend assets")
	devOrigin := flag.String("dev-origin", "", "Exact HTTP loopback origin allowed for the Vite development proxy")
	version := flag.Bool("version", false, "Print version and exit")
	flag.Parse()
	if *version {
		fmt.Println("TerraDock " + server.Version)
		return nil
	}
	if *port < 1 || *port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	absAssets, err := filepath.Abs(*assets)
	if err != nil {
		return fmt.Errorf("resolve assets: %w", err)
	}
	manager, err := workspace.New(*root)
	if err != nil {
		return err
	}
	defer manager.Close()
	app, err := server.New(manager, absAssets, server.Options{DevOrigin: *devOrigin})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	httpServer := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errors := make(chan error, 1)
	go func() { errors <- httpServer.Serve(listener) }()
	log.Printf("TerraDock %s · http://%s · local project root: %s", server.Version, listener.Addr(), manager.Root())
	select {
	case err := <-errors:
		if err != http.ErrServerClosed {
			return err
		}
		return nil
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			_ = httpServer.Close()
			return nil
		}
		return nil
	}
}
