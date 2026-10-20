// Package mail adapts action messages to private local files or encrypted SMTP delivery.
package mail

import (
	"context"
	"errors"

	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/workspace"
)

var ErrDelivery = errors.New("mail delivery failed")

type disabled struct{}

func (disabled) Available() bool                                  { return false }
func (disabled) Send(context.Context, workspace.ActionMail) error { return ErrDelivery }

// New validates configuration without contacting an SMTP server or creating a mailbox.
func New(cfg config.Mail) (workspace.ActionMailer, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	switch cfg.Transport {
	case "outbox":
		return &outbox{directory: cfg.OutboxDir}, nil
	case "smtp":
		return &smtpSender{config: cfg}, nil
	default:
		return disabled{}, nil
	}
}

func safeFailure(ctx context.Context) error { return errors.Join(ErrDelivery, ctx.Err()) }
