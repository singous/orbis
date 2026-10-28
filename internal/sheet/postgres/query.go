package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/sheet"
)

const interactiveQueryTimeout = "3s"

type ordering struct {
	expr, field string
	desc        bool
}
type plan struct {
	joins, where   string
	joinArgs, args []any
	order          []ordering
	view           sheet.View
}
type cursor struct {
	OrderRevision int64  `json:"o,omitempty"`
	Query         string `json:"q"`
	Version       int64  `json:"v"`
	Keys          []any  `json:"k"`
	ID            string `json:"id"`
}

func selectView(t sheet.Sheet, id string) (sheet.View, error) {
	for _, v := range t.Definition.Views {
		if v.ID == id || id == "" {
			return v, nil
		}
	}
	return sheet.View{}, sheet.Invalid("视图不存在")
}
func queryPlan(t sheet.Sheet, q sheet.Query) (plan, error) {
	v, err := selectView(t, q.ViewID)
	if err != nil {
		return plan{}, err
	}
	p := plan{where: "r.sheet_id=?", args: []any{t.ID}, view: v}
	fields := sheet.Fields(t.Definition)
	filters := append([]sheet.Filter{}, v.Filters...)
	if q.Group != nil && v.GroupFieldID != "" {
		op := "eq"
		var value any = *q.Group
		if *q.Group == "" {
			op = "empty"
			value = nil
		}
		filters = append(filters, sheet.Filter{FieldID: v.GroupFieldID, Operator: op, Value: value})
	}
	for _, f := range filters {
		field := fields[f.FieldID]
		column := "c.text_value"
		if sheet.Kinds[field.Kind].Numeric {
			column = "c.number_value"
		}
		base := "SELECT 1 FROM sheet_cells c WHERE c.sheet_id=r.sheet_id AND c.record_id=r.id AND c.field_id=?"
		a := []any{f.FieldID}
		cond := ""
		negate := false
		switch f.Operator {
		case "empty":
			negate = true
		case "not_empty":
		case "contains":
			cond = " AND strpos(c.text_value,?)>0"
			if sheet.Kinds[field.Kind].Multiple {
				cond = " AND c.text_value=? AND md5(c.text_value)=md5(?)"
			}
			a = append(a, fmt.Sprint(f.Value))
			if sheet.Kinds[field.Kind].Multiple {
				a = append(a, fmt.Sprint(f.Value))
			}
		case "ne":
			negate = true
			fallthrough
		case "eq", "gt", "gte", "lt", "lte":
			op := map[string]string{"eq": "=", "ne": "=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[f.Operator]
			if f.Value == nil {
				negate = f.Operator == "eq"
			}
			if f.Value != nil {
				value := f.Value
				if field.Kind == "checkbox" {
					value = fmt.Sprint(value)
				}
				cond = " AND " + column + op + "?"
				a = append(a, value)
				if column == "c.text_value" && (f.Operator == "eq" || f.Operator == "ne") {
					cond += " AND md5(c.text_value)=md5(?)"
					a = append(a, value)
				}
			}
		}
		prefix := "EXISTS"
		if negate {
			prefix = "NOT EXISTS"
		}
		p.where += " AND " + prefix + "(" + base + cond + ")"
		p.args = append(p.args, a...)
	}
	if q.Search != "" {
		p.where += " AND EXISTS(SELECT 1 FROM sheet_cells c WHERE c.sheet_id=r.sheet_id AND c.record_id=r.id AND strpos(lower(c.text_value),lower(?))>0)"
		p.args = append(p.args, q.Search)
	}
	sorts := []sheet.Sort{}
	if v.GroupFieldID != "" {
		sorts = append(sorts, sheet.Sort{FieldID: v.GroupFieldID})
	}
	sorts = append(sorts, v.Sorts...)
	seen := map[string]bool{}
	for _, s := range sorts {
		if seen[s.FieldID] {
			continue
		}
		seen[s.FieldID] = true
		f := fields[s.FieldID]
		expr := ""
		switch f.Kind {
		case "created_at":
			expr = "r.created_at_ms"
		case "updated_at":
			expr = "r.updated_at_ms"
		case "created_by":
			expr = "r.created_by"
		case "updated_by":
			expr = "r.updated_by"
		default:
			alias := fmt.Sprintf("s%d", len(p.order))
			p.joins += " LEFT JOIN sheet_cells " + alias + " ON " + alias + ".sheet_id=r.sheet_id AND " + alias + ".record_id=r.id AND " + alias + ".field_id=? AND " + alias + ".ordinal=0"
			p.joinArgs = append(p.joinArgs, f.ID)
			expr = alias + ".text_value"
			if sheet.Kinds[f.Kind].Numeric {
				expr = alias + ".number_value"
			}
		}
		p.order = append(p.order, ordering{expr: expr, field: f.ID, desc: s.Descending})
	}
	if len(p.order) == 0 {
		p.order = append(p.order, ordering{expr: "r.position"})
	}
	p.order = append(p.order, ordering{expr: "r.id"})
	return p, nil
}
func fingerprint(t sheet.Sheet, q sheet.Query) string {
	b, _ := json.Marshal([]any{t.WorkspaceID, t.ID, q.ViewID, q.Search, q.Group})
	return security.Digest(string(b))
}
func applyCursor(p *plan, t sheet.Sheet, q sheet.Query) error {
	if q.Cursor == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(q.Cursor)
	if err != nil {
		return sheet.Invalid("分页游标无效")
	}
	var c cursor
	if err = json.Unmarshal(raw, &c); err != nil || c.Query != fingerprint(t, q) || c.Version != t.Version || c.OrderRevision != t.OrderRevision || !sheet.ValidID(c.ID) || len(c.Keys) != len(p.order) {
		return sheet.Invalid("分页已过期，请刷新列表")
	}
	for i, key := range c.Keys {
		if key != nil {
			numeric := p.order[i].expr == "r.position" || strings.HasSuffix(p.order[i].expr, "_at_ms") || strings.HasSuffix(p.order[i].expr, ".number_value")
			if numeric {
				if _, ok := key.(float64); !ok {
					return sheet.Invalid("分页游标无效")
				}
			} else if _, ok := key.(string); !ok {
				return sheet.Invalid("分页游标无效")
			}
		}

		switch value := key.(type) {
		case nil:
		case string:
			if len(value) > sheet.MaxText {
				return sheet.Invalid("分页游标无效")
			}
		case float64:
		default:
			return sheet.Invalid("分页游标无效")
		}
		if i == len(c.Keys)-1 && key != c.ID {
			return sheet.Invalid("分页游标无效")
		}
	}
	if len(p.order) == 2 && p.order[0].expr == "r.position" {
		p.where += " AND (r.position,r.id)>(?,?)"
		p.args = append(p.args, c.Keys[0], c.ID)
		return nil
	}
	branches := []string{}
	args := []any{}
	for i, o := range p.order {
		prefix := []string{}
		a := []any{}
		for j := 0; j < i; j++ {
			if c.Keys[j] == nil {
				prefix = append(prefix, p.order[j].expr+" IS NULL")
			} else {
				prefix = append(prefix, p.order[j].expr+"=?")
				a = append(a, c.Keys[j])
			}
		}
		if c.Keys[i] == nil {
			continue
		}
		op := ">"
		if o.desc {
			op = "<"
		}
		prefix = append(prefix, "("+o.expr+op+"? OR "+o.expr+" IS NULL)")
		a = append(a, c.Keys[i])
		branches = append(branches, "("+strings.Join(prefix, " AND ")+")")
		args = append(args, a...)
	}
	if len(branches) == 0 {
		return sheet.Invalid("分页游标无效")
	}
	p.where += " AND (" + strings.Join(branches, " OR ") + ")"
	p.args = append(p.args, args...)
	return nil
}
func nextCursor(p plan, t sheet.Sheet, q sheet.Query, row recordRow) string {
	record := row.domain(t.Definition)
	keys := []any{}
	for _, o := range p.order {
		var value any
		switch o.expr {
		case "r.id":
			value = row.ID
		case "r.position":
			value = row.Position
		default:
			value = record.Values[o.field]
			if f := sheet.Fields(t.Definition)[o.field]; f.Kind == "checkbox" && value != nil {
				value = fmt.Sprint(value)
			}
		}
		keys = append(keys, value)
	}
	raw, _ := json.Marshal(cursor{OrderRevision: t.OrderRevision, Query: fingerprint(t, q), Version: t.Version, Keys: keys, ID: row.ID})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func (r *Repository) Records(ctx context.Context, sc sheet.Scope, q sheet.Query) (sheet.Page, error) {
	result := sheet.Page{Items: []sheet.Record{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT set_config('statement_timeout',?,true)", interactiveQueryTimeout).Error; err != nil {
			return err
		}
		t, err := get(ctx, tx, sc, "")
		if err != nil {
			return err
		}
		p, err := queryPlan(t, q)
		if err != nil {
			return err
		}
		if err := applyCursor(&p, t, q); err != nil {
			return err
		}
		order := []string{}
		for _, o := range p.order {
			direction := " ASC"
			if o.desc {
				direction = " DESC"
			}
			order = append(order, o.expr+direction+" NULLS LAST")
		}
		args := append(append([]any{}, p.joinArgs...), p.args...)
		args = append(args, q.Limit+1)
		var rows []recordRow
		if err := tx.Raw("SELECT r.* FROM sheet_records r"+p.joins+" WHERE "+p.where+" ORDER BY "+strings.Join(order, ",")+" LIMIT ?", args...).Scan(&rows).Error; err != nil {
			return err
		}
		if len(p.view.HighlightDuplicates) > 0 && len(rows) > 0 {
			ids := []string{}
			for _, row := range rows {
				ids = append(ids, row.ID)
			}
			result.DuplicateIDs = map[string][]string{}
			for _, id := range p.view.HighlightDuplicates {
				column := "text_value"
				if sheet.Kinds[sheet.Fields(t.Definition)[id].Kind].Numeric {
					column = "number_value"
				}
				var repeated []string
				sql := "SELECT c.record_id FROM sheet_cells c WHERE c.sheet_id=? AND c.field_id=? AND c.record_id IN ? AND EXISTS (SELECT 1 FROM sheet_cells d WHERE d.sheet_id=c.sheet_id AND d.field_id=c.field_id AND d.record_id<>c.record_id AND d." + column + "=c." + column
				if column == "text_value" {
					sql += " AND md5(d.text_value)=md5(c.text_value)"
				}
				sql += ")"
				if err := tx.Raw(sql, t.ID, id, ids).Scan(&repeated).Error; err != nil {
					return err
				}
				if repeated == nil {
					repeated = []string{}
				}
				result.DuplicateIDs[id] = repeated
			}
		}
		result.SchemaVersion = t.SchemaVersion
		if len(rows) > q.Limit {
			rows = rows[:q.Limit]
			result.NextCursor = nextCursor(p, t, q, rows[len(rows)-1])
		}
		for _, row := range rows {
			result.Items = append(result.Items, row.domain(t.Definition))
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Repository) Stats(ctx context.Context, sc sheet.Scope, q sheet.Query) (sheet.Stats, error) {
	result := sheet.Stats{Groups: []sheet.Group{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT set_config('statement_timeout',?,true)", interactiveQueryTimeout).Error; err != nil {
			return err
		}
		t, err := get(ctx, tx, sc, "")
		if err != nil {
			return err
		}
		p, err := queryPlan(t, q)
		if err != nil {
			return err
		}
		if len(p.view.Filters) == 0 && q.Search == "" && q.Group == nil {
			if err := tx.Table("sheet_activity").Select("record_count").Where("sheet_id=?", t.ID).Scan(&result.Total).Error; err != nil {
				return err
			}
		} else if err := tx.Raw("SELECT count(*) FROM sheet_records r WHERE "+p.where, p.args...).Scan(&result.Total).Error; err != nil {
			return err
		}
		if p.view.GroupFieldID != "" {
			args := append([]any{p.view.GroupFieldID}, p.args...)
			return tx.Raw("SELECT coalesce(c.text_value,'') AS value,count(*) AS count FROM sheet_records r LEFT JOIN sheet_cells c ON c.sheet_id=r.sheet_id AND c.record_id=r.id AND c.field_id=? AND c.ordinal=0 WHERE "+p.where+" GROUP BY c.text_value", args...).Scan(&result.Groups).Error
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
