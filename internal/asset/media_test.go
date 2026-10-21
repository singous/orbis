package asset_test

import (
	"encoding/binary"
	"testing"

	"orbis.local/orbis/internal/asset"
)

func TestMediaSniffingDoesNotTrustActiveContentHints(t *testing.T) {
	if media := asset.MediaType([]byte("<script>alert(1)</script>"), "image/png"); asset.InlineType(media) {
		t.Fatal("HTML was promoted to an inline image")
	}
	box := make([]byte, 24)
	binary.BigEndian.PutUint32(box[:4], 24)
	copy(box[4:8], "ftyp")
	copy(box[8:12], "avif")
	copy(box[16:20], "avif")
	if asset.MediaType(box, "application/octet-stream") != "image/avif" {
		t.Fatal("AVIF was not detected")
	}
	for _, media := range []string{"text/html", "image/svg+xml", "application/pdf"} {
		if asset.InlineType(media) {
			t.Fatalf("active content type %s can render inline", media)
		}
	}
	if name := asset.Filename("../folder\\说明\r\n.txt"); name != "说明.txt" {
		t.Fatalf("unsafe filename normalization: %q", name)
	}
}
