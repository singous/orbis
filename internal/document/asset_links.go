package document

import (
	"strings"

	"github.com/google/uuid"
)

const AssetLinkPrefix = "asset:"

func AssetLink(id string) string { return AssetLinkPrefix + id }
func ParseAssetLink(value string) (string, bool) {
	if !strings.HasPrefix(value, AssetLinkPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(value, AssetLinkPrefix)
	parsed, err := uuid.Parse(id)
	return id, err == nil && parsed != uuid.Nil && parsed.String() == id
}
