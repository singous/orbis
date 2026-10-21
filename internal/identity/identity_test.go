package identity_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"orbis.local/orbis/internal/identity"
)

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type failedRepository struct {
	identity.Repository
	err error
}

func (r failedRepository) FindUserByEmail(context.Context, string) (identity.User, error) {
	return identity.User{}, r.err
}
func (r failedRepository) FindSession(context.Context, string) (identity.Session, error) {
	return identity.Session{}, r.err
}
func (r failedRepository) FindSessionByHash(context.Context, string) (identity.Session, error) {
	return identity.Session{}, r.err
}

func TestAuthenticationPreservesInfrastructureErrors(t *testing.T) {
	t.Parallel()
	key := strings.Repeat("test-signing-key-", 4)
	now := time.Date(
		2026,
		10,
		16,
		0,
		0,
		0,
		0,
		time.UTC,
	)
	failure := errors.New("synthetic database outage")
	service := identity.New(
		failedRepository{err: failure},
		nil,
		fixedClock{now: now},
		key,
		time.Minute,
		time.Hour,
		"",
		"",
	)
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": uuid.NewString(), "sid": uuid.NewString(), "iss": "orbis", "aud": "orbis-api",
		"iat": now.Unix(), "exp": now.Add(time.Minute).Unix(),
	}).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		call func() error
	}{
		{
			name: "login",
			call: func() error { _, err := service.Login(t.Context(), "user@example.test", "password"); return err },
		},
		{name: "access token", call: func() error { _, err := service.Authenticate(t.Context(), token); return err }},
		{
			name: "refresh token",
			call: func() error { _, err := service.Refresh(t.Context(), strings.Repeat("x", 43)); return err },
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.call(); !errors.Is(err, failure) {
				t.Fatalf("infrastructure error was replaced: %v", err)
			}
		})
	}
}
