package security

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const passwordMemory = 64 * 1024
const passwordIterations = 3
const passwordParallelism = 2
const legacyPasswordParallelism = 4
const passwordSaltBytes = 16
const passwordKeyBytes = 32

type Passwords struct{ slots chan struct{} }

// NewPasswords bounds concurrent memory-intensive password work.
func NewPasswords() *Passwords { return &Passwords{slots: make(chan struct{}, 2)} }
func (p *Passwords) acquire(ctx context.Context) error {
	select {
	case p.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Hash creates an Argon2id PHC record using a fresh random salt.
func (p *Passwords) Hash(ctx context.Context, password string) (string, error) {
	if err := p.acquire(ctx); err != nil {
		return "", err
	}
	defer func() { <-p.slots }()
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey(
		[]byte(password),
		salt,
		passwordIterations,
		passwordMemory,
		passwordParallelism,
		passwordKeyBytes,
	)
	enc := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf(
		"$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		passwordMemory,
		passwordIterations,
		passwordParallelism,
		enc(salt),
		enc(key),
	), nil
}

// Verify accepts the configured PHC parameters and compares derived keys in constant time.
func (p *Passwords) Verify(ctx context.Context, password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, nil
	}
	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(
		parts[3],
		"m=%d,t=%d,p=%d",
		&memory,
		&iterations,
		&parallelism,
	); err != nil {
		return false, nil
	}
	if memory != passwordMemory || iterations != passwordIterations || (parallelism != passwordParallelism && parallelism != legacyPasswordParallelism) {
		return false, nil
	}
	if parts[3] != fmt.Sprintf("m=%d,t=%d,p=%d", memory, iterations, parallelism) {
		return false, nil
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != passwordSaltBytes {
		return false, nil
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) != passwordKeyBytes {
		return false, nil
	}
	if err := p.acquire(ctx); err != nil {
		return false, err
	}
	defer func() { <-p.slots }()
	got := argon2.IDKey(
		[]byte(password),
		salt,
		iterations,
		memory,
		parallelism,
		passwordKeyBytes,
	)
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
