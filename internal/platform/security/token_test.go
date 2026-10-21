package security_test

import (
	"strings"
	"testing"

	"orbis.local/orbis/internal/platform/security"
)

func TestCursorRejectsTamperingAndOtherKeys(t *testing.T) {
	t.Parallel()
	signer := security.NewCursorSigner(strings.Repeat("a", 32))
	want := struct {
		Version int64 `json:"version"`
	}{Version: 7}
	token, err := signer.Encode(want)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Version int64 `json:"version"`
	}
	if err := signer.Decode(token, &got); err != nil || got.Version != 7 {
		t.Fatalf("cursor round trip: %v", err)
	}
	parts := strings.Split(token, ".")
	if err := signer.Decode("e30."+parts[1], &got); err == nil {
		t.Fatal("modified cursor accepted")
	}
	if err := security.NewCursorSigner(strings.Repeat("b", 32)).Decode(token, &got); err == nil {
		t.Fatal("cursor from another key accepted")
	}
}
