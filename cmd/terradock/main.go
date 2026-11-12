package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/RenzoAL7/TerraDock/internal/floci"
	"github.com/RenzoAL7/TerraDock/internal/server"
	"github.com/RenzoAL7/TerraDock/internal/workspace"
	"github.com/RenzoAL7/TerraDock/web"
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
	assets := flag.String("assets", "web/dist", "Directory containing built frontend assets (release binaries carry their own)")
	open := flag.Bool("open", web.Files != nil, "Open the browser once the server is ready")
	devOrigin := flag.String("dev-origin", "", "Exact HTTP loopback origin allowed for the Vite development proxy")
	flociEndpoint := flag.String("floci-endpoint", floci.DefaultEndpoint, "Local Floci endpoint used for plan/apply (loopback or *.floci.io)")
	terraformBin := flag.String("terraform", "", "Terraform or OpenTofu binary (default: lookup in PATH)")
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
	runner, err := floci.New(floci.Config{Endpoint: *flociEndpoint, Terraform: *terraformBin}, func() floci.Project {
		snapshot, files := manager.Files()
		return floci.Project{ID: snapshot.ID, Name: snapshot.Name, Dir: snapshot.Path, Files: files}
	})
	if err != nil {
		return err
	}
	defer runner.Close()
	options := server.Options{DevOrigin: *devOrigin, Floci: runner}
	if web.Files != nil && !flagSet("assets") {
		options.Files = web.Files
	}
	app, err := server.New(manager, absAssets, options)
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
	address := "http://" + listener.Addr().String()
	log.Printf("TerraDock %s · local project root: %s", server.Version, manager.Root())
	log.Printf("Open %s in your browser. Press Ctrl+C to stop.", address)
	if *open {
		openBrowser(address)
	}
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

func flagSet(name string) bool {
	set := false
	flag.Visit(func(f *flag.Flag) { set = set || f.Name == name })
	return set
}

// openBrowser is best effort: the address is always printed as well.
func openBrowser(address string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", address)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	if err := cmd.Start(); err == nil {
		go func() { _ = cmd.Wait() }()
	}
}
