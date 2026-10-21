//go:build integration

package sharing_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/tests/testenv"
)

func TestConvertedLegacyShareKeepsBearerAndRecoversOnlyWithCorrectKey(t *testing.T) {
	f := newShare(t)
	key := "synthetic-legacy-live-share-secret"
	hash := hmac.New(sha256.New, []byte(key))
	hash.Write([]byte("orbis:live-document-share:v1:" + f.share.Share.ID + ":" + f.wid + ":" + f.cid + ":" + f.root))
	raw := base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
	if err := f.env.DB.Table("document_shares").Where("id=?", f.share.Share.ID).Update("token_digest", security.Digest(raw)).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", "/api/v1/public/shares/"+raw+"/directory", "", nil, 200)
	paths := func() *string {
		result := testenv.Decode[struct {
			Items []struct {
				ID   string
				Path *string
			}
		}](t, f.env.Call(t, "GET", f.base+"/shares", f.session.AccessToken, nil, 200))
		for _, item := range result.Items {
			if item.ID == f.share.Share.ID {
				return item.Path
			}
		}
		t.Fatal("converted share missing from manager")
		return nil
	}
	if paths() != nil {
		t.Fatal("missing legacy key produced an invalid replacement URL")
	}
	f.env.UseLegacySecrets(t, "", key)
	if path := paths(); path == nil || *path != "/share/"+raw {
		t.Fatal("matching old key did not recover the original bearer URL")
	}
	f.env.UseLegacySecrets(t, "", "synthetic-wrong-live-share-secret")
	if paths() != nil {
		t.Fatal("wrong key produced an invalid replacement URL")
	}
	f.env.Call(t, "GET", "/api/v1/public/shares/"+raw+"/directory", "", nil, 200)
}
