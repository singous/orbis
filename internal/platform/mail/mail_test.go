package mail

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/workspace"
)

func TestOutboxWritesPrivateCompleteMessages(t *testing.T) {
	t.Parallel()
	directory := filepath.Join(t.TempDir(), "mail")
	sender, err := New(config.Mail{Transport: "outbox", OutboxDir: directory, PublicBaseURL: "https://example.test"})
	if err != nil {
		t.Fatal(err)
	}
	message := workspace.ActionMail{Kind: workspace.InvitationMail, ActionID: "synthetic-action", Recipient: "recipient@example.test", Token: "synthetic-capability"}
	if err := sender.Send(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || filepath.Ext(entries[0].Name()) != ".json" {
		t.Fatal("outbox exposed partial or unexpected files")
	}
	info, err := entries[0].Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal("outbox message permissions are not private")
	}
	data, err := os.ReadFile(filepath.Join(directory, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	var actual workspace.ActionMail
	if err := json.Unmarshal(data, &actual); err != nil {
		t.Fatal(err)
	}
	if actual.Token != message.Token || actual.Recipient != message.Recipient {
		t.Fatal("outbox message did not round trip")
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if err := sender.Send(cancelled, message); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled delivery did not preserve cancellation")
	}
	entries, err = os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatal("cancelled delivery wrote another message")
	}
}
