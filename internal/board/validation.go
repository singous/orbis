package board

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/fault"
)

type Shape struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	Primitive string `json:"primitive"`
	Container bool   `json:"container"`
	Path      string `json:"path"`
}
type Catalog struct{ Shapes map[string]Shape }

func ParseCatalog(data []byte) (Catalog, error) {
	var input struct {
		Shapes []Shape `json:"shapes"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return Catalog{}, err
	}
	shapes := make(map[string]Shape, len(input.Shapes))
	for _, shape := range input.Shapes {
		shapes[shape.ID] = shape
	}
	return Catalog{Shapes: shapes}, nil
}
func ValidID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
func Invalid(message string) error { return fault.Field("body", message) }
func Conflict(id string) error {
	return &fault.Error{Kind: fault.Conflict, Code: "BOARD_ELEMENT_CONFLICT", Message: "图元已被其他操作修改，本机修改仍保留", Details: map[string]string{"element_id": id}}
}
func Removed(id string) error {
	return &fault.Error{Kind: fault.Conflict, Code: "BOARD_TARGET_REMOVED", Message: "目标图元已删除，本机修改仍保留", Details: map[string]string{"element_id": id}}
}
func Limit() error {
	return fault.New(fault.Validation, "BOARD_LIMIT_EXCEEDED", "画板内容超出容量限制")
}
func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Abs(value) <= MaxCoordinate
}
func validText(value string, max int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
}

var colorPattern = regexp.MustCompile(`^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$`)
var iconPattern = regexp.MustCompile(`^[a-z0-9-]{1,100}$`)

func validMarker(value string) bool {
	switch value {
	case "none", "arrow", "triangle", "diamond", "circle", "one", "many":
		return true
	}
	return false
}
func ValidatePage(page Page) error {
	if !ValidID(page.ID) || !validText(page.Name, 120) || strings.TrimSpace(page.Name) == "" || !colorPattern.MatchString(page.Background) || page.Position < 0 || page.Position >= MaxPages || page.Version < 0 || page.Version > MaxVersion {
		return Invalid("画板页面格式不正确")
	}
	return nil
}
func (c Catalog) Validate(element *Element) error {
	e := element
	if !ValidID(e.ID) || !ValidID(e.PageID) || e.ShapeVersion != 1 {
		return Invalid("图元标识或格式版本不正确")
	}
	shape, exists := c.Shapes[e.ShapeType]
	if !exists && e.ShapeType != "connector" {
		return Invalid("不支持的图形类型")
	}
	g, s, st := e.Geometry, e.Style, &e.Structure
	if !finite(g.X) || !finite(g.Y) || !finite(g.Width) || !finite(g.Height) || !finite(g.Rotation) || g.Width <= 0 || g.Height <= 0 || math.Abs(g.Rotation) > 2*math.Pi {
		return Invalid("图形位置或尺寸无效")
	}
	if !colorPattern.MatchString(s.Fill) || !colorPattern.MatchString(s.Stroke) || !colorPattern.MatchString(s.TextColor) || !finite(s.StrokeWidth) || s.StrokeWidth < 0 || s.StrokeWidth > 32 || !finite(s.FontSize) || s.FontSize < 8 || s.FontSize > 144 || !finite(s.Opacity) || s.Opacity < 0 || s.Opacity > 1 {
		return Invalid("图形样式无效")
	}
	if s.Align != "left" && s.Align != "center" && s.Align != "right" {
		return Invalid("文字对齐方式无效")
	}
	if !validText(e.Text, MaxText) || st.Order < -MaxVersion || st.Order > MaxVersion {
		return Limit()
	}
	if st.ParentID != nil && (!ValidID(*st.ParentID) || *st.ParentID == e.ID) {
		return Invalid("图元父级无效")
	}
	if st.AssetID != nil && !ValidID(*st.AssetID) {
		return Invalid("图片资产标识无效")
	}
	if st.IconID != "" && !iconPattern.MatchString(st.IconID) {
		return Invalid("图标标识无效")
	}
	if st.Route != "straight" && st.Route != "orthogonal" && st.Route != "curve" {
		return Invalid("连接线路由无效")
	}
	if !validMarker(st.StartMarker) || !validMarker(st.EndMarker) {
		return Invalid("连接线端点样式无效")
	}
	if len(st.Points) > MaxPoints || len(st.Members) > MaxMembers {
		return Limit()
	}
	for _, point := range st.Points {
		if !finite(point.X) || !finite(point.Y) {
			return Invalid("图元路径无效")
		}
	}
	seen := map[string]bool{}
	for _, member := range st.Members {
		if !ValidID(member.ID) || seen[member.ID] || !validText(member.Name, 240) || !validText(member.Type, 120) || (member.Key != "" && member.Key != "primary" && member.Key != "foreign") {
			return Invalid("图形成员格式无效")
		}
		seen[member.ID] = true
	}
	if len(st.Members) > 0 && shape.Primitive != "entity" && shape.Primitive != "weak-entity" && shape.Primitive != "class" {
		return Invalid("该图形不支持成员字段")
	}
	if e.ShapeType == "connector" {
		if st.Start == nil || st.End == nil || st.ParentID != nil {
			return Invalid("连接线须声明两端，且不能属于容器")
		}
	} else if st.Start != nil || st.End != nil {
		return Invalid("普通图元不能声明连接端点")
	}
	for _, endpoint := range []*Endpoint{st.Start, st.End} {
		if endpoint == nil {
			continue
		}
		if !finite(endpoint.X) || !finite(endpoint.Y) || (endpoint.ElementID != nil && !ValidID(*endpoint.ElementID)) || !validText(endpoint.Port, 80) {
			return Invalid("连接线端点无效")
		}
	}
	if st.Members == nil {
		st.Members = []Member{}
	}
	if st.Points == nil {
		st.Points = []Point{}
	}
	raw, err := json.Marshal(e)
	if err != nil || len(raw) > MaxElementBytes {
		return Limit()
	}
	return nil
}
func (c Catalog) ValidateRelations(e Element, get func(string) (Element, bool)) error {
	seen := map[string]bool{e.ID: true}
	parent := e.Structure.ParentID
	for depth := 0; parent != nil; depth++ {
		if depth >= MaxDepth || seen[*parent] {
			return Invalid("图元父子关系存在循环或超出深度")
		}
		seen[*parent] = true
		p, ok := get(*parent)
		if !ok || p.PageID != e.PageID || (!c.Shapes[p.ShapeType].Container && !strings.HasPrefix(p.ShapeType, "mindmap.")) {
			return Invalid("父图元不存在或不支持包含子图元")
		}
		parent = p.Structure.ParentID
	}
	for _, endpoint := range []*Endpoint{e.Structure.Start, e.Structure.End} {
		if endpoint == nil || endpoint.ElementID == nil {
			continue
		}
		node, ok := get(*endpoint.ElementID)
		if !ok || node.PageID != e.PageID || node.ShapeType == "connector" {
			return Invalid("连接端点不属于当前页面的有效图元")
		}
		parts := strings.Split(endpoint.Port, ":")
		if len(parts) == 2 && parts[0] == "time" && node.ShapeType == "uml.lifeline" {
			position, err := strconv.ParseFloat(parts[1], 64)
			if err != nil || !finite(position) || position < 0.2 || position > 1 {
				return Invalid("时序消息位置无效")
			}
			continue
		}
		if len(parts) > 2 || (parts[0] != "left" && parts[0] != "right" && parts[0] != "top" && parts[0] != "bottom") {
			return Invalid("连接端口无效")
		}
		if len(parts) == 2 {
			found := false
			for _, member := range node.Structure.Members {
				if member.ID == parts[1] {
					found = true
				}
			}
			if !found || (parts[0] != "left" && parts[0] != "right") {
				return Invalid("字段连接端口不存在")
			}
		}
	}
	return nil
}
func ApplyPatch(e Element, patch Patch) (Element, error) {
	if e.Version >= MaxVersion {
		return e, Limit()
	}
	if patch.Geometry == nil && patch.Style == nil && patch.Text == nil && patch.Structure == nil {
		return e, Invalid("图元更新不能为空")
	}
	if (patch.Geometry != nil && (patch.Expected.Geometry != e.Versions.Geometry || patch.Expected.Structure != e.Versions.Structure)) ||
		(patch.Style != nil && patch.Expected.Style != e.Versions.Style) ||
		(patch.Text != nil && patch.Expected.Text != e.Versions.Text) ||
		(patch.Structure != nil && patch.Expected.Structure != e.Versions.Structure) {
		return e, Conflict(e.ID)
	}
	if patch.Structure != nil && (patch.Expected.Geometry != e.Versions.Geometry || patch.Expected.Text != e.Versions.Text) {
		return e, Conflict(e.ID)
	}
	if patch.Geometry != nil {
		e.Geometry = *patch.Geometry
		e.Versions.Geometry++
	}
	if patch.Style != nil {
		e.Style = *patch.Style
		e.Versions.Style++
	}
	if patch.Text != nil {
		e.Text = *patch.Text
		e.Versions.Text++
	}
	if patch.Structure != nil {
		e.Structure = *patch.Structure
		e.Versions.Structure++
	}
	e.Version++
	return e, nil
}
