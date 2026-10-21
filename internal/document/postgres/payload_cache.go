package postgres

import (
	"encoding/json"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/security"
)

func cacheBlock(row *blockRow) error {
	var payload document.Payload
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	size, digest := len(encoded), security.Digest(string(encoded))
	row.Payload = encoded
	row.PayloadBytes = &size
	row.PayloadDigest = &digest
	return nil
}
func cacheBlocks(rows []blockRow) error {
	for i := range rows {
		if err := cacheBlock(&rows[i]); err != nil {
			return err
		}
	}
	return nil
}
