package security

import (
	"encoding/base64"
	"fmt"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestLegacyPythonPasswordProfileRemainsUsable(t *testing.T) {
	password := "synthetic-legacy-password-2026"
	salt := []byte("legacy-salt-2026")
	key := argon2.IDKey([]byte(password), salt, 3, 65536, 4, 32)
	encoded := fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=4$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
	passwords := NewPasswords()
	if ok, err := passwords.Verify(t.Context(), password, encoded); err != nil || !ok {
		t.Fatalf("legacy account password was rejected: %v", err)
	}
	if ok, err := passwords.Verify(t.Context(), "wrong password", encoded); err != nil || ok {
		t.Fatal("legacy hash accepted wrong credentials")
	}
	oversized := "$argon2id$v=19$m=1048576,t=3,p=4$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key)
	if ok, err := passwords.Verify(t.Context(), password, oversized); err != nil || ok {
		t.Fatal("verification accepted an unbounded memory profile")
	}
}
