package migrations

import (
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

const Version = 27

//go:embed *.sql
var files embed.FS

// Up applies embedded migrations explicitly and treats an already-current schema as success.
func Up(databaseURL string) (result error) {
	source, err := iofs.New(files, ".")
	if err != nil {
		return fmt.Errorf("open migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, databaseURL)
	if err != nil {
		// Driver errors may contain a credential-bearing connection URL.
		return errors.Join(fmt.Errorf("connect migration driver"), source.Close())
	}
	defer func() {
		sourceErr, databaseErr := m.Close()
		result = errors.Join(result, sourceErr, databaseErr)
	}()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
