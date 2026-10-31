package postgres

import (
	"context"
	"encoding/json"
	"sort"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
)

type mutationState struct {
	originals map[string]elementRow
	elements  map[string]board.Element
	changed   map[string]bool
	deleted   map[string]bool
}

func loadRows(ctx context.Context, tx *gorm.DB, id string, ids []string, state *mutationState) error {
	pending := []string{}
	seen := map[string]bool{}
	for _, key := range ids {
		if key != "" && !seen[key] {
			seen[key] = true
			if _, exists := state.originals[key]; !exists {
				pending = append(pending, key)
			}
		}
	}
	if len(pending) == 0 {
		return nil
	}
	var rows []elementRow
	if err := tx.WithContext(ctx).Where("board_id=? AND id IN ?", id, pending).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		state.originals[row.ID] = row
		if !state.changed[row.ID] && !state.deleted[row.ID] {
			var e board.Element
			if err := json.Unmarshal(row.Payload, &e); err != nil {
				return err
			}
			state.elements[e.ID] = e
		}
	}
	return nil
}
func references(e board.Element) []string {
	result := []string{}
	if e.Structure.ParentID != nil {
		result = append(result, *e.Structure.ParentID)
	}
	for _, endpoint := range []*board.Endpoint{e.Structure.Start, e.Structure.End} {
		if endpoint != nil && endpoint.ElementID != nil {
			result = append(result, *endpoint.ElementID)
		}
	}
	return result
}
func (r *Repository) Mutate(ctx context.Context, sc board.Scope, in board.Mutation, hash string, now int64) (board.Change, error) {
	result := board.Change{OperationID: in.OperationID, Elements: []board.Element{}, Deleted: []string{}, Pages: []board.Page{}, DeletedPages: []string{}, UpdatedAtMS: now}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		header, doc, err := loadHeader(ctx, tx, sc, true)
		if err != nil {
			return err
		}
		if previous, ok, err := replay(ctx, tx, sc, in.OperationID, hash); err != nil {
			return err
		} else if ok {
			result = previous
			return nil
		}
		if header.Revision >= board.MaxVersion {
			return board.Limit()
		}
		result.Revision = header.Revision + 1
		state := mutationState{originals: map[string]elementRow{}, elements: map[string]board.Element{}, changed: map[string]bool{}, deleted: map[string]bool{}}
		ids := []string{}
		createdIDs := []string{}
		for _, command := range in.Commands {
			for _, e := range command.Elements {
				ids = append(ids, e.ID)
				createdIDs = append(createdIDs, e.ID)
			}
			for _, patch := range command.Patches {
				ids = append(ids, patch.ID)
			}
			for _, target := range command.Targets {
				ids = append(ids, target.ID)
			}
		}
		if err := loadRows(ctx, tx, sc.BoardID, ids, &state); err != nil {
			return err
		}
		if len(createdIDs) > 0 {
			var count int64
			if err := tx.Model(&elementVersion{}).Where("board_id=? AND id IN ?", sc.BoardID, createdIDs).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return board.Invalid("已有或已删除的图元标识不能用于新建")
			}
		}
		var pageRows []pageRow
		if err := tx.Where("board_id=?", sc.BoardID).Find(&pageRows).Error; err != nil {
			return err
		}
		pageMap := map[string]board.Page{}
		pageOriginal := map[string]pageRow{}
		changedPages := map[string]bool{}
		deletedPages := map[string]bool{}
		for _, row := range pageRows {
			var page board.Page
			if err := json.Unmarshal(row.Payload, &page); err != nil {
				return err
			}
			pageMap[row.ID] = page
			pageOriginal[row.ID] = row
		}
		for _, command := range in.Commands {
			switch command.Type {
			case "elements.create":
				for _, e := range command.Elements {
					if _, ok := state.elements[e.ID]; ok || state.changed[e.ID] || state.deleted[e.ID] {
						return board.Invalid("批次图元标识重复")
					}
					if _, ok := pageMap[e.PageID]; !ok {
						return fault.Missing()
					}
					e.Version = 1
					e.Versions = board.Versions{Geometry: 1, Style: 1, Text: 1, Structure: 1}
					state.elements[e.ID] = e
					state.changed[e.ID] = true
				}
			case "elements.update", "layout.apply":
				for _, patch := range command.Patches {
					e, ok := state.elements[patch.ID]
					if !ok || state.deleted[patch.ID] {
						return board.Removed(patch.ID)
					}
					e, err = board.ApplyPatch(e, patch)
					if err != nil {
						return err
					}
					if err := r.catalog.Validate(&e); err != nil {
						return err
					}
					state.elements[e.ID] = e
					state.changed[e.ID] = true
				}
			case "elements.restore":
				for _, target := range command.Targets {
					if _, exists := state.elements[target.ID]; exists && !state.deleted[target.ID] {
						return board.Conflict(target.ID)
					}
					if state.changed[target.ID] || state.deleted[target.ID] {
						return board.Invalid("恢复与删除须分为独立操作")
					}
					var historical elementVersion
					if err := tx.Where("board_id=? AND id=?", sc.BoardID, target.ID).Order("valid_from DESC").Take(&historical).Error; err != nil {
						return missing(err)
					}
					var e board.Element
					if err := json.Unmarshal(historical.Payload, &e); err != nil {
						return err
					}
					if historical.ValidTo == nil || e.Version != target.Version || e.Version >= board.MaxVersion {
						return board.Conflict(target.ID)
					}
					if _, exists := pageMap[e.PageID]; !exists {
						return board.Invalid("请先恢复图元所属页面")
					}
					e.Version++
					e.Versions.Geometry++
					e.Versions.Style++
					e.Versions.Text++
					e.Versions.Structure++
					state.elements[e.ID] = e
					state.changed[e.ID] = true
				}
			case "elements.delete":
				queue := []string{}
				for _, target := range command.Targets {
					e, ok := state.elements[target.ID]
					if !ok || state.deleted[target.ID] {
						return board.Removed(target.ID)
					}
					if e.Version != target.Version {
						return board.Conflict(target.ID)
					}
					queue = append(queue, target.ID)
				}
				for len(queue) > 0 {
					current := []string{}
					for _, id := range queue {
						if !state.deleted[id] {
							state.deleted[id] = true
							delete(state.changed, id)
							current = append(current, id)
						}
					}
					if len(current) == 0 {
						break
					}
					if len(state.deleted) > board.MaxBatch {
						return board.Limit()
					}
					var dependents []elementRow
					if err := tx.Where("board_id=? AND (parent_id IN ? OR start_id IN ? OR end_id IN ?)", sc.BoardID, current, current, current).Limit(board.MaxBatch + 1).Find(&dependents).Error; err != nil {
						return err
					}
					queue = []string{}
					for _, row := range dependents {
						if state.deleted[row.ID] {
							continue
						}
						if _, exists := state.originals[row.ID]; !exists {
							state.originals[row.ID] = row
							var e board.Element
							if err := json.Unmarshal(row.Payload, &e); err != nil {
								return err
							}
							state.elements[e.ID] = e
						}
						e := state.elements[row.ID]
						for _, ref := range references(e) {
							if state.deleted[ref] {
								queue = append(queue, row.ID)
								break
							}
						}
					}
					for id, e := range state.elements {
						if !state.deleted[id] {
							for _, ref := range references(e) {
								if state.deleted[ref] {
									queue = append(queue, id)
									break
								}
							}
						}
					}
				}
			case "pages.create":
				page := *command.Page
				if _, ok := pageMap[page.ID]; ok || deletedPages[page.ID] {
					return board.Invalid("页面标识重复")
				}
				if page.Version != 0 || len(pageMap) >= board.MaxPages {
					return board.Limit()
				}
				// Historical page IDs cannot be reused because they identify published references.
				var previous int64
				if err := tx.Model(&revisionRow{}).Where("board_id=? AND pages @> ?::jsonb", sc.BoardID, `[{"id":"`+page.ID+`"}]`).Count(&previous).Error; err != nil {
					return err
				}
				if previous > 0 {
					return board.Invalid("历史页面标识不能用于新建")
				}
				page.Version = 1
				pageMap[page.ID] = page
				changedPages[page.ID] = true
			case "pages.restore":
				incoming := *command.Page
				if _, exists := pageMap[incoming.ID]; exists || len(pageMap) >= board.MaxPages {
					return board.Conflict(incoming.ID)
				}
				var previous revisionRow
				if err := tx.Where("board_id=? AND pages @> ?::jsonb", sc.BoardID, `[{"id":"`+incoming.ID+`"}]`).Order("revision DESC").Take(&previous).Error; err != nil {
					return missing(err)
				}
				var stored []board.Page
				if err := json.Unmarshal(previous.Pages, &stored); err != nil {
					return err
				}
				for _, page := range stored {
					if page.ID == incoming.ID {
						if page.Version != incoming.Version || page.Version >= board.MaxVersion {
							return board.Conflict(page.ID)
						}
						page.Version++
						pageMap[page.ID] = page
						changedPages[page.ID] = true
					}
				}
			case "pages.update", "pages.delete":
				incoming := *command.Page
				page, ok := pageMap[incoming.ID]
				if !ok {
					return fault.Missing()
				}
				if page.Version != incoming.Version {
					return board.Conflict(page.ID)
				}
				if command.Type == "pages.delete" {
					deletedPages[page.ID] = true
					delete(pageMap, page.ID)
					delete(changedPages, page.ID)
				} else {
					incoming.Version++
					pageMap[page.ID] = incoming
					changedPages[page.ID] = true
				}
			}
		}
		if len(pageMap) == 0 {
			return board.Invalid("画板至少保留一个页面")
		}
		if len(state.changed)+len(state.deleted) > board.MaxBatch {
			return board.Limit()
		}
		// Load affected edges to reject removed field ports unless the same command updates their bindings.
		targets := []string{}
		for id := range state.changed {
			targets = append(targets, id)
		}
		if len(targets) > 0 {
			var edges []elementRow
			if err := tx.Where("board_id=? AND (start_id IN ? OR end_id IN ?)", sc.BoardID, targets, targets).Limit(board.MaxPageElements + 1).Find(&edges).Error; err != nil {
				return err
			}
			if len(edges) > board.MaxPageElements {
				return board.Limit()
			}
			for _, row := range edges {
				if _, ok := state.originals[row.ID]; !ok {
					state.originals[row.ID] = row
					if !state.changed[row.ID] && !state.deleted[row.ID] {
						var e board.Element
						if err := json.Unmarshal(row.Payload, &e); err != nil {
							return err
						}
						state.elements[e.ID] = e
					}
				}
			}
		}
		// Resolve parent and endpoint closures in bounded batches rather than one query per element.
		for depth := 0; depth <= board.MaxDepth; depth++ {
			needed := []string{}
			for id, e := range state.elements {
				if !state.deleted[id] {
					for _, ref := range references(e) {
						if _, ok := state.elements[ref]; !ok && !state.deleted[ref] {
							needed = append(needed, ref)
						}
					}
				}
			}
			if len(needed) == 0 {
				break
			}
			before := len(state.elements)
			if err := loadRows(ctx, tx, sc.BoardID, needed, &state); err != nil {
				return err
			}
			if len(state.elements) == before {
				break
			}
		}
		lookup := func(id string) (board.Element, bool) { e, ok := state.elements[id]; return e, ok && !state.deleted[id] }
		for id, e := range state.elements {
			if state.deleted[id] {
				continue
			}
			if err := r.catalog.ValidateRelations(e, lookup); err != nil {
				return err
			}
			if state.changed[id] {
				if _, ok := pageMap[e.PageID]; !ok {
					return board.Invalid("删除页面前须先删除其图元")
				}
			}
		}
		countDelta := map[string]int{}
		byteDelta := map[string]int64{}
		assets := map[string]bool{}
		for id := range state.changed {
			e := state.elements[id]
			row, err := rowFor(sc.BoardID, e)
			if err != nil {
				return err
			}
			before, exists := state.originals[id]
			if !exists {
				countDelta[e.PageID]++
			} else {
				byteDelta[e.PageID] -= int64(before.PayloadBytes)
			}
			byteDelta[e.PageID] += int64(row.PayloadBytes)
			if e.Structure.AssetID != nil {
				assets[*e.Structure.AssetID] = true
			}
		}
		for id := range state.deleted {
			if row, ok := state.originals[id]; ok {
				countDelta[row.PageID]--
				byteDelta[row.PageID] -= int64(row.PayloadBytes)
			}
		}
		total := 0
		for id, page := range pageMap {
			before := pageOriginal[id]
			count := before.ElementCount + countDelta[id]
			size := before.ElementBytes + byteDelta[id]
			total += count
			if count < 0 || count > board.MaxPageElements || size < 0 || size > board.MaxPageBytes {
				return board.Limit()
			}
			data, err := json.Marshal(page)
			if err != nil {
				return err
			}
			if before.ID == "" {
				if err := tx.Create(&pageRow{BoardID: sc.BoardID, ID: id, Payload: data, ElementCount: count, ElementBytes: size}).Error; err != nil {
					return err
				}
			} else if changedPages[id] || countDelta[id] != 0 || byteDelta[id] != 0 {
				if err := tx.Model(&pageRow{}).Where("board_id=? AND id=?", sc.BoardID, id).Updates(map[string]any{"payload": data, "element_count": count, "element_bytes": size}).Error; err != nil {
					return err
				}
			}
		}
		if total > board.MaxBoardElements {
			return board.Limit()
		}
		assetIDs := []string{}
		for id := range assets {
			assetIDs = append(assetIDs, id)
		}
		sort.Strings(assetIDs)
		for _, id := range assetIDs {
			if err := requireAsset(ctx, tx, sc.WorkspaceID, id); err != nil {
				return err
			}
		}
		changedIDs := []string{}
		for id := range state.changed {
			changedIDs = append(changedIDs, id)
		}
		sort.Strings(changedIDs)
		for _, id := range changedIDs {
			e := state.elements[id]
			if err := writeElement(ctx, tx, sc.BoardID, e, result.Revision); err != nil {
				return err
			}
			result.Elements = append(result.Elements, e)
		}
		deletedIDs := []string{}
		for id := range state.deleted {
			deletedIDs = append(deletedIDs, id)
		}
		sort.Strings(deletedIDs)
		if len(deletedIDs) > 0 {
			if err := tx.Where("board_id=? AND id IN ?", sc.BoardID, deletedIDs).Delete(&elementRow{}).Error; err != nil {
				return err
			}
			if err := tx.Model(&elementVersion{}).Where("board_id=? AND id IN ? AND valid_to IS NULL", sc.BoardID, deletedIDs).Update("valid_to", result.Revision).Error; err != nil {
				return err
			}
			result.Deleted = deletedIDs
		}
		for id := range deletedPages {
			before := pageOriginal[id]
			if before.ElementCount+countDelta[id] != 0 {
				return board.Invalid("删除页面前须先删除其图元")
			}
			if err := tx.Where("board_id=? AND id=?", sc.BoardID, id).Delete(&pageRow{}).Error; err != nil {
				return err
			}
			result.DeletedPages = append(result.DeletedPages, id)
		}
		for id := range changedPages {
			result.Pages = append(result.Pages, pageMap[id])
		}
		updated := tx.Model(&header).Where("id=? AND revision=?", sc.BoardID, header.Revision).Updates(map[string]any{"revision": result.Revision, "updated_at_ms": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return board.Conflict(sc.BoardID)
		}
		return commitRevision(ctx, tx, sc, doc.Title, result, hash)
	})
	return result, err
}
