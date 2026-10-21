package main

import (
	"context"
	"io"
	"os"
	"testing"
	"time"
)

func TestCancellationClosesBlockedInputAndJoinsWorker(t *testing.T) {
	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer writer.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	finished := make(chan struct{})
	stopped := interruptInput(ctx, finished, input)
	readDone := make(chan error, 1)
	go func() { _, err := io.ReadAll(input); readDone <- err }()
	cancel()
	select {
	case err := <-readDone:
		if err == nil {
			t.Fatal("cancellation did not interrupt input")
		}
	case <-time.After(time.Second):
		t.Fatal("blocked input did not exit")
	}
	<-stopped
}

func TestCompletedCommandStopsWorkerWithoutClosingInput(t *testing.T) {
	input, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer writer.Close()
	finished := make(chan struct{})
	stopped := interruptInput(t.Context(), finished, input)
	close(finished)
	<-stopped
	if _, err := input.Stat(); err != nil {
		t.Fatal("normal completion closed input")
	}
}
