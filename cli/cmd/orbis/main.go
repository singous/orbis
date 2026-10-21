package main

import (
	"context"
	"io"
	"os"
	"os/signal"
	"syscall"

	"orbis.local/orbis/cli/internal/command"
)

func main() {
	os.Exit(run())
}

func run() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	finished := make(chan struct{})
	inputStopped := interruptInput(ctx, finished, os.Stdin)
	exit := command.Default().Run(ctx, os.Args[1:])
	close(finished)
	<-inputStopped
	return exit
}

func interruptInput(ctx context.Context, finished <-chan struct{}, input io.Closer) <-chan struct{} {
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		select {
		case <-ctx.Done():
			_ = input.Close()
		case <-finished:
		}
	}()
	return stopped
}
