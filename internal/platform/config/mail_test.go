package config_test

import (
	"testing"
	"time"

	"orbis.local/orbis/internal/platform/config"
)

func TestMailValidation(t *testing.T) {
	for _, test := range []struct {
		name  string
		mail  config.Mail
		valid bool
	}{
		{name: "disabled", valid: true},
		{name: "local outbox", mail: config.Mail{Transport: "outbox", OutboxDir: "mail", PublicBaseURL: "https://example.test/orbis"}, valid: true},
		{name: "missing directory", mail: config.Mail{Transport: "outbox", PublicBaseURL: "https://example.test"}},
		{name: "credential URL", mail: config.Mail{Transport: "outbox", OutboxDir: "mail", PublicBaseURL: "https://user:secret@example.test"}},
		{name: "query URL", mail: config.Mail{Transport: "outbox", OutboxDir: "mail", PublicBaseURL: "https://example.test?token=secret"}},
		{name: "plaintext SMTP", mail: config.Mail{Transport: "smtp", PublicBaseURL: "https://example.test", From: "sender@example.test", SMTPAddress: "localhost:25", SMTPSecurity: "none", Timeout: time.Second}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.mail.Validate(); (err == nil) != test.valid {
				t.Fatalf("mail validation result did not match expectation: %v", err)
			}
		})
	}
}
