package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

// RandomToken creates an unguessable URL-safe credential from cryptographic entropy.
func RandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Digest produces the stored fingerprint of a high-entropy credential or canonical request.
func Digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

type CursorSigner struct{ key []byte }

// NewCursorSigner separates pagination signatures from access-token signing.
func NewCursorSigner(key string) *CursorSigner {
	return &CursorSigner{key: []byte("orbis-cursor-v1:" + key)}
}

// Encode authenticates the serialized cursor scope and continuation state.
func (s *CursorSigner) Encode(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// Decode checks size and signature before reading cursor state.
func (s *CursorSigner) Decode(token string, value any) error {
	if len(token) > 2048 {
		return errors.New("cursor too long")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return errors.New("invalid cursor")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return errors.New("invalid cursor signature")
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}
