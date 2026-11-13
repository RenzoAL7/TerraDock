package main

import (
	"context"
	"errors"
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
	"strings"
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

// config is the parsed command line. A project path may be given as the only
// positional argument or with --open-path.
type config struct {
	port          int
	root          string
	rootSet       bool
	openPath      string
	assets        string
	assetsSet     bool
	open          bool
	devOrigin     string
	flociEndpoint string
	terraform     string
	version       bool
}

func parseArgs(args []string) (config, error) {
	var c config
	fs := flag.NewFlagSet("terradock", flag.ContinueOnError)
	fs.IntVar(&c.port, "port", 7331, "HTTP port on 127.0.0.1")
	fs.StringVar(&c.root, "root", ".", "Allowed root directory for local projects (default: the project path, or the current directory)")
	fs.StringVar(&c.openPath, "open-path", "", "Terraform folder to open at startup (same as the positional argument)")
	fs.StringVar(&c.assets, "assets", "web/dist", "Directory containing built frontend assets (release binaries carry their own)")
	fs.BoolVar(&c.open, "open", web.Files != nil, "Open the browser once the server is ready")
	fs.StringVar(&c.devOrigin, "dev-origin", "", "Exact HTTP loopback origin allowed for the Vite development proxy")
	fs.StringVar(&c.flociEndpoint, "floci-endpoint", floci.DefaultEndpoint, "Local Floci endpoint used for plan/apply (loopback or *.floci.io)")
	fs.StringVar(&c.terraform, "terraform", "", "Terraform or OpenTofu binary (default: lookup in PATH)")
	fs.BoolVar(&c.version, "version", false, "Print version and exit")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "Uso: terradock [opciones] [carpeta-del-proyecto]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	// Go stops parsing flags at the first positional argument; accept flags
	// after the project path too (terradock ./infra --port 8080).
	positional := ""
	if fs.NArg() > 0 {
		positional = fs.Arg(0)
		if err := fs.Parse(fs.Args()[1:]); err != nil {
			return c, err
		}
		if fs.NArg() > 0 {
			return c, fmt.Errorf("solo se admite una carpeta de proyecto; sobra: %s", strings.Join(fs.Args(), " "))
		}
	}
	fs.Visit(func(f *flag.Flag) {
		c.rootSet = c.rootSet || f.Name == "root"
		c.assetsSet = c.assetsSet || f.Name == "assets"
	})
	if positional != "" && c.openPath != "" && positional != c.openPath {
		return c, fmt.Errorf("indica la carpeta del proyecto una sola vez: como argumento o con --open-path")
	}
	if positional != "" {
		c.openPath = positional
	}
	if c.port < 1 || c.port > 65535 {
		return c, fmt.Errorf("port must be between 1 and 65535")
	}
	// Without an explicit --root, a project path is also the allowed root.
	if c.openPath != "" && !c.rootSet {
		c.root = c.openPath
	}
	return c, nil
}

// checkOpenPath explains in Spanish, before the workspace starts, why a
// project path from the command line cannot be opened. Without it, the path
// would first fail as --root with a less specific message.
func checkOpenPath(path string) error {
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return fmt.Errorf("no se puede abrir %s: la carpeta no existe", path)
	}
	if err != nil {
		return fmt.Errorf("no se puede abrir %s: no se pudo leer (%v)", path, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("no se puede abrir %s: es un archivo, no una carpeta. Indica la carpeta que contiene los archivos .tf", path)
	}
	return nil
}

// openInitial decides what the first snapshot shows. An explicit project path
// must open; otherwise the root opens when it holds .tf files, and the bundled
// example stays when it does not. Opening never runs Terraform.
func openInitial(manager *workspace.Manager, openPath string) (workspace.Snapshot, error) {
	if openPath != "" {
		target, err := filepath.Abs(openPath)
		if err == nil {
			target, err = filepath.EvalSymlinks(target)
		}
		if err != nil {
			return workspace.Snapshot{}, fmt.Errorf("no se puede abrir %s: la carpeta no existe", openPath)
		}
		snapshot, err := manager.Open(target)
		if err != nil {
			return workspace.Snapshot{}, fmt.Errorf("no se puede abrir %s: %w", openPath, err)
		}
		return snapshot, nil
	}
	snapshot, err := manager.Open(manager.Root())
	if err != nil {
		var problem *workspace.Error
		if errors.As(err, &problem) && problem.Code == "no_terraform" {
			return manager.Snapshot(), nil
		}
		// A root that cannot be read as a project still serves the picker.
		log.Printf("No se pudo abrir la raíz como proyecto (%v). Se muestra el ejemplo.", err)
		return manager.Snapshot(), nil
	}
	return snapshot, nil
}

// listen binds the loopback port and explains the usual failure in Spanish.
func listen(port int) (net.Listener, error) {
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err == nil {
		return listener, nil
	}
	if addressInUse(err) {
		next := port + 1
		if next > 65535 {
			next = 7331
		}
		return nil, fmt.Errorf("el puerto %d ya está en uso en 127.0.0.1. Si ya tienes TerraDock abierto, usa esa ventana o ciérralo; si no, elige otro puerto con --port (por ejemplo: terradock --port %d)", port, next)
	}
	return nil, fmt.Errorf("listen: %w", err)
}

func addressInUse(err error) bool {
	var errno syscall.Errno
	// 10048 is WSAEADDRINUSE: Windows reports it instead of syscall.EADDRINUSE.
	return errors.As(err, &errno) && (errno == syscall.EADDRINUSE || errno == 10048)
}

func run() error {
	c, err := parseArgs(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
	if err != nil {
		return err
	}
	if c.version {
		fmt.Println("TerraDock " + server.Version)
		return nil
	}
	absAssets, err := filepath.Abs(c.assets)
	if err != nil {
		return fmt.Errorf("resolve assets: %w", err)
	}
	if err := checkOpenPath(c.openPath); err != nil {
		return err
	}
	manager, err := workspace.New(c.root)
	if err != nil {
		return err
	}
	defer manager.Close()
	initial, err := openInitial(manager, c.openPath)
	if err != nil {
		return err
	}
	runner, err := floci.New(floci.Config{Endpoint: c.flociEndpoint, Terraform: c.terraform}, func() floci.Project {
		snapshot, files := manager.Files()
		return floci.Project{ID: snapshot.ID, Name: snapshot.Name, Dir: snapshot.Path, Files: files}
	})
	if err != nil {
		return err
	}
	defer runner.Close()
	options := server.Options{DevOrigin: c.devOrigin, Floci: runner}
	if web.Files != nil && !c.assetsSet {
		options.Files = web.Files
	}
	app, err := server.New(manager, absAssets, options)
	if err != nil {
		return err
	}
	listener, err := listen(c.port)
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(listener) }()
	address := "http://" + listener.Addr().String()
	log.Printf("TerraDock %s · raíz permitida para proyectos locales: %s", server.Version, manager.Root())
	if initial.Mode == "local" {
		log.Printf("Proyecto abierto: %s", initial.Path)
	}
	log.Printf("Abre %s en el navegador. Pulsa Ctrl+C para detenerlo.", address)
	if c.open {
		openBrowser(address)
	}
	select {
	case err := <-served:
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
