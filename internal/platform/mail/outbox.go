package mail

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/workspace"
)

type outbox struct{ directory string }

func (*outbox) Available() bool { return true }

// Send writes a private complete message before exposing its final filename.
func (s *outbox) Send(ctx context.Context, message workspace.ActionMail) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.write(ctx, message); err != nil {
		return safeFailure(ctx)
	}
	return nil
}

func (s *outbox) write(ctx context.Context, message workspace.ActionMail) (result error) {
	if err := os.MkdirAll(s.directory, 0700); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, root.Close()) }()
	name := uuid.NewString() + ".json"
	temporary := "." + name + ".tmp"
	file, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			if err := root.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
				result = errors.Join(result, err)
			}
		}
	}()
	if err := file.Chmod(0600); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := json.NewEncoder(file).Encode(message); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Sync(); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := root.Rename(temporary, name); err != nil {
		return err
	}
	complete = true
	return nil
}
