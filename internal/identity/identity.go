package identity

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
)

type User struct {
	PreferredWorkspaceID     *string
	ID, Email, PasswordHash  string
	AvatarAssetID            *string
	DisplayName, Bio         *string
	ProfileVersion           int64
	CreatedAtMS, UpdatedAtMS int64
}
type Session struct {
	ID, UserID, TokenHash    string
	ExpiresAtMS              int64
	RevokedAtMS              *int64
	CreatedAtMS, UpdatedAtMS int64
}
type Actor struct{ UserID, SessionID string }

var ErrNotFound = errors.New("identity record not found")

type Tokens struct {
	AccessToken, RefreshToken string
	ExpiresAtMS               int64
	User                      User
}

type Repository interface {
	UpdateProfile(context.Context, ProfileChange) (User, error)
	FindUser(context.Context, string) (User, error)
	FindUserByEmail(context.Context, string) (User, error)
	CreateSession(context.Context, Session) error
	FindSession(context.Context, string) (Session, error)
	FindSessionByHash(context.Context, string) (Session, error)
	RotateSession(context.Context, string, string, string, clock.Clock) error
	RevokeSession(context.Context, string, string, int64) error
}
type Passwords interface {
	Hash(context.Context, string) (string, error)
	Verify(context.Context, string, string) (bool, error)
}

const MaxLoginPasswordCharacters = 256

type Service struct {
	repo                  Repository
	passwords             Passwords
	clock                 clock.Clock
	key                   []byte
	accessTTL, refreshTTL time.Duration
	dummyHash             string
	legacyRefreshSecret   string
}

// New binds account use cases to explicit session settings and a controllable clock.
func New(
	repo Repository,
	passwords Passwords,
	c clock.Clock,
	key string,
	accessTTL, refreshTTL time.Duration,
	dummyHash string,
	legacyRefreshSecret string,
) *Service {
	return &Service{
		repo:                repo,
		passwords:           passwords,
		clock:               c,
		key:                 []byte(key),
		accessTTL:           accessTTL,
		refreshTTL:          refreshTTL,
		dummyHash:           dummyHash,
		legacyRefreshSecret: legacyRefreshSecret,
	}
}

// NormalizeEmail applies the account lookup normalization before persistence or login.
func NormalizeEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 320 {
		return "", fault.Field("body.email", "邮箱格式不正确")
	}
	return email, nil
}

// PrepareUser validates and hashes registration input without persisting an account.
func (s *Service) PrepareUser(ctx context.Context, email, password, name string) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	if len(password) < 12 || len(password) > 128 {
		return User{}, fault.Field("body.password", "密码长度必须在 12 至 128 字节之间")
	}
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > MaxDisplayNameLength {
		return User{}, fault.Field("body.display_name", "显示名称长度必须在 1 至 120 个字符之间")
	}
	hash, err := s.passwords.Hash(ctx, password)
	if err != nil {
		return User{}, err
	}
	now := s.clock.Now().UnixMilli()
	return User{
		ID:             uuid.NewString(),
		Email:          email,
		PasswordHash:   hash,
		DisplayName:    &name,
		ProfileVersion: 1,
		CreatedAtMS:    now,
		UpdatedAtMS:    now,
	}, nil
}

// Login verifies the password and creates a revocable server-side session.
func (s *Service) Login(ctx context.Context, email, password string) (Tokens, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return Tokens{}, err
	}
	if !utf8.ValidString(password) || len(password) > MaxLoginPasswordCharacters*utf8.UTFMax || utf8.RuneCountInString(password) < 1 || utf8.RuneCountInString(password) > MaxLoginPasswordCharacters {
		return Tokens{}, fault.Field("body.password", "密码长度不正确")
	}
	user, lookupErr := s.repo.FindUserByEmail(ctx, email)
	if lookupErr != nil && !errors.Is(lookupErr, ErrNotFound) {
		return Tokens{}, lookupErr
	}
	hash := user.PasswordHash
	if lookupErr != nil {
		hash = s.dummyHash
	}
	match, err := s.passwords.Verify(ctx, password, hash)
	if err != nil {
		return Tokens{}, err
	}
	if lookupErr != nil || !match {
		return Tokens{}, fault.New(fault.Unauthenticated, "INVALID_CREDENTIALS", "邮箱或密码不正确")
	}
	session, result, err := s.PrepareSession(user)
	if err != nil {
		return Tokens{}, err
	}
	if err := s.repo.CreateSession(ctx, session); err != nil {
		return Tokens{}, err
	}
	return result, nil
}

// PrepareSession lets registration persist its account, membership, and session in one transaction.
func (s *Service) PrepareSession(user User) (Session, Tokens, error) {
	refresh, err := security.RandomToken()
	if err != nil {
		return Session{}, Tokens{}, err
	}
	now := s.clock.Now()
	session := Session{
		ID: uuid.NewString(), UserID: user.ID, TokenHash: security.Digest(refresh),
		ExpiresAtMS: now.Add(s.refreshTTL).UnixMilli(), CreatedAtMS: now.UnixMilli(), UpdatedAtMS: now.UnixMilli(),
	}
	result, err := s.tokens(user, session.ID, refresh)
	return session, result, err
}

type claims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

func (s *Service) tokens(user User, sid, refresh string) (Tokens, error) {
	now := s.clock.Now()
	expires := now.Add(s.accessTTL).Truncate(time.Second)
	c := claims{SessionID: sid, RegisteredClaims: jwt.RegisteredClaims{
		Subject:   user.ID,
		Issuer:    "orbis",
		Audience:  jwt.ClaimStrings{"orbis-api"},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expires),
	}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.key)
	return Tokens{AccessToken: token, RefreshToken: refresh, ExpiresAtMS: expires.UnixMilli(), User: user}, err
}

// Authenticate checks both signed claims and current session state.
func (s *Service) Authenticate(ctx context.Context, raw string) (Actor, error) {
	if len(raw) > 4096 {
		return Actor{}, fault.Auth()
	}
	c := new(claims)
	_, err := jwt.ParseWithClaims(
		raw,
		c,
		func(_ *jwt.Token) (any, error) { return s.key, nil },
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer("orbis"),
		jwt.WithAudience("orbis-api"),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(s.clock.Now),
	)
	if err != nil || c.Subject == "" || c.SessionID == "" {
		return Actor{}, fault.Auth()
	}
	session, err := s.repo.FindSession(ctx, c.SessionID)
	if errors.Is(err, ErrNotFound) {
		return Actor{}, fault.Auth()
	}
	if err != nil {
		return Actor{}, err
	}
	invalidSession := session.UserID != c.Subject || session.RevokedAtMS != nil
	if invalidSession || session.ExpiresAtMS <= s.clock.Now().UnixMilli() {
		return Actor{}, fault.Auth()
	}
	return Actor{UserID: c.Subject, SessionID: c.SessionID}, nil
}

// Refresh rotates the credential with compare-and-swap so only one concurrent retry succeeds.
func (s *Service) Refresh(ctx context.Context, refresh string) (Tokens, error) {
	hash := ""
	switch {
	case len(refresh) == 43:
		hash = security.Digest(refresh)
	case len(refresh) == 64 && s.legacyRefreshSecret != "":
		hash = security.Digest(s.legacyRefreshSecret + ":" + refresh)
	default:
		return Tokens{}, fault.Auth()
	}

	session, err := s.repo.FindSessionByHash(ctx, hash)
	if errors.Is(err, ErrNotFound) {
		return Tokens{}, fault.Auth()
	}
	if err != nil {
		return Tokens{}, err
	}
	if session.RevokedAtMS != nil || session.ExpiresAtMS <= s.clock.Now().UnixMilli() {
		return Tokens{}, fault.Auth()
	}
	user, err := s.repo.FindUser(ctx, session.UserID)
	if errors.Is(err, ErrNotFound) {
		return Tokens{}, fault.Auth()
	}
	if err != nil {
		return Tokens{}, err
	}
	next, err := security.RandomToken()
	if err != nil {
		return Tokens{}, err
	}
	result, err := s.tokens(user, session.ID, next)
	if err != nil {
		return Tokens{}, err
	}
	if err := s.repo.RotateSession(
		ctx,
		session.ID,
		hash,
		security.Digest(next),
		s.clock,
	); err != nil {
		return Tokens{}, err
	}
	return result, nil
}

// Logout revokes the session used by both access and refresh credentials.
func (s *Service) Logout(ctx context.Context, actor Actor) error {
	return s.repo.RevokeSession(
		ctx,
		actor.SessionID,
		actor.UserID,
		s.clock.Now().UnixMilli(),
	)
}

// Me resolves the authenticated actor without exposing password material.
func (s *Service) Me(ctx context.Context, actor Actor) (User, error) {
	user, err := s.repo.FindUser(ctx, actor.UserID)
	if errors.Is(err, ErrNotFound) {
		return User{}, fault.Auth()
	}
	return user, err
}
