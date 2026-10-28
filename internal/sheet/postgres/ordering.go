package postgres

import (
	"encoding/json"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/sheet"
)

type placement struct {
	ID       string `json:"id"`
	AnchorID string `json:"anchor_id"`
	Before   bool   `json:"before"`
	Ordinal  int    `json:"ordinal"`
}

// placeRecords runs under the exclusive schema lock acquired before any row locks.
// Dense ranks fit below the identity sequence, so ordinary inserts still append.
// Only physical positions of neighboring rows change; their content versions stay valid.
func placeRecords(tx *gorm.DB, sheetID string, patches []sheet.Patch, result []sheet.Record) error {
	placements := []placement{}
	anchors := []string{}
	for _, patch := range patches {
		anchor := patch.BeforeID
		if anchor == "" {
			anchor = patch.AfterID
		}
		if anchor == "" {
			continue
		}
		placements = append(placements, placement{patch.ID, anchor, patch.BeforeID != "", len(placements)})
		anchors = append(anchors, anchor)
	}
	if len(placements) == 0 {
		return nil
	}
	var count int64
	if err := tx.Table("sheet_records").Where("sheet_id=? AND id IN ?", sheetID, anchors).Distinct("id").Count(&count).Error; err != nil {
		return err
	}
	unique := map[string]bool{}
	for _, id := range anchors {
		unique[id] = true
	}
	if count != int64(len(unique)) {
		return sheet.Conflict()
	}
	raw, err := json.Marshal(placements)
	if err != nil {
		return err
	}
	// Fractional sort keys exist only inside this statement; persisted positions remain integers.
	err = tx.Exec(`WITH placements AS (
 SELECT * FROM jsonb_to_recordset(?::jsonb) AS p(id uuid, anchor_id uuid, "before" boolean, ordinal int)
 ), ordered AS (
 SELECT r.id, row_number() OVER (ORDER BY
 CASE WHEN p.id IS NULL THEN r.position::numeric ELSE a.position::numeric
   + CASE WHEN p."before" THEN -1 ELSE 0 END
   + (p.ordinal + 1)::numeric / ?::numeric END, r.id) AS position
 FROM sheet_records r LEFT JOIN placements p ON p.id=r.id
 LEFT JOIN sheet_records a ON a.sheet_id=r.sheet_id AND a.id=p.anchor_id
 WHERE r.sheet_id=?
 ) UPDATE sheet_records r SET position=o.position FROM ordered o
 WHERE r.sheet_id=? AND r.id=o.id AND r.position IS DISTINCT FROM o.position`, string(raw), len(placements)+1, sheetID, sheetID).Error
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(result))
	for _, record := range result {
		ids = append(ids, record.ID)
	}
	var rows []struct {
		ID       string
		Position int64
	}
	if err := tx.Table("sheet_records").Select("id,position").Where("sheet_id=? AND id IN ?", sheetID, ids).Find(&rows).Error; err != nil {
		return err
	}
	positions := map[string]int64{}
	for _, row := range rows {
		positions[row.ID] = row.Position
	}
	for i := range result {
		result[i].Position = positions[result[i].ID]
	}
	return nil
}
