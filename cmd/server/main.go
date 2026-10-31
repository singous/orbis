package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/app"
	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/migrations"
)

var version = "0.1.1"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(os.Args[1:], logger); err != nil {
		logger.Error("Application stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string, logger *slog.Logger) error {
	flags := flag.NewFlagSet("orbis-server", flag.ContinueOnError)
	showVersion := flags.Bool("version", false, "Print the application version")
	healthcheck := flags.Bool("healthcheck", false, "Check local HTTP readiness")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if *showVersion {
		fmt.Println(version)
		return nil
	}
	if *healthcheck {
		return checkHealth()
	}
	action := "serve"
	if flags.NArg() > 1 {
		return fmt.Errorf("expected at most one command: serve, migrate, gc-assets, or gc-imports")
	}
	if flags.NArg() == 1 {
		action = flags.Arg(0)
	}
	if action != "serve" && action != "migrate" && action != "gc-assets" && action != "gc-imports" {
		return fmt.Errorf("unknown command %q", action)
	}
	if action == "migrate" {
		databaseURL := os.Getenv("ORBIS_DATABASE_URL")
		if err := config.ValidateDatabaseURL(databaseURL); err != nil {
			return err
		}
		if err := migrations.Up(databaseURL); err != nil {
			return err
		}
		logger.Info("Database migrations completed", "version", migrations.Version)
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if action != "serve" {
		cfg.RedisURL = ""
	}
	gin.SetMode(gin.ReleaseMode)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, cfg.ReadTimeout)
	application, err := app.New(startup, cfg, logger)
	cancel()
	if err != nil {
		return err
	}
	if action == "gc-assets" || action == "gc-imports" {
		cleanup, cancelCleanup := context.WithTimeout(ctx, cfg.WriteTimeout)
		var count int
		var err error
		if action == "gc-imports" {
			count, err = application.CleanupImports(cleanup)
		} else {
			count, err = application.CleanupAssets(cleanup)
		}
		cancelCleanup()
		err = errors.Join(err, application.Close())
		if err == nil {
			logger.Info("Maintenance completed", "command", action, "purged", count)
		}
		return err
	}
	server := &http.Server{
		Addr: cfg.Address, Handler: application.Handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 32 << 10,
	}
	listener, err := net.Listen("tcp", cfg.Address)
	if err != nil {
		return errors.Join(fmt.Errorf("listen: %w", err), application.Close())
	}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	logger.Info(
		"HTTP server started",
		"address",
		cfg.Address,
		"version",
		version,
	)
	select {
	case err := <-finished:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		return errors.Join(err, application.Close())
	case <-ctx.Done():
		stop()
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancelShutdown()
	shutdownErr := server.Shutdown(shutdown)
	if shutdownErr != nil {
		shutdownErr = errors.Join(shutdownErr, server.Close())
	}
	serveErr := <-finished
	if errors.Is(serveErr, http.ErrServerClosed) {
		serveErr = nil
	}
	return errors.Join(shutdownErr, serveErr, application.Close())
}

func checkHealth() error {
	host, port, err := net.SplitHostPort(config.ListenAddress())
	if err != nil {
		return fmt.Errorf("invalid healthcheck address")
	}
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + net.JoinHostPort(host, port) + "/readyz")
	if err != nil {
		return fmt.Errorf("HTTP readiness probe failed: %w", err)
	}
	closeErr := response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.Join(fmt.Errorf("HTTP readiness status %d", response.StatusCode), closeErr)
	}
	return closeErr
}
