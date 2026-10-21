package publishing

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var pagePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$`)

func ValidID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}
func ValidSlug(value string) bool {
	return len(value) > 0 && len(value) <= MaxSiteSlug && slugPattern.MatchString(value)
}
func ValidPageSlug(value string) bool {
	return len(value) > 0 && len(value) <= MaxPageSlug && pagePattern.MatchString(value)
}
func validText(value string, min, max int) bool {
	n := utf8.RuneCountInString(value)
	return utf8.ValidString(value) && n >= min && n <= max && !strings.ContainsRune(value, 0)
}
func Normalize(input Config) (Config, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !validText(input.Name, 1, 160) {
		return Config{}, fault.Field("body.name", "站点名称长度必须在 1 至 160 个字符之间")
	}
	if !ValidSlug(input.Slug) {
		return Config{}, fault.Field("body.slug", "站点路径须使用小写英文、数字和连字符，最多 80 字符")
	}
	if !validText(input.Description, 0, 2000) {
		return Config{}, fault.Field("body.description", "站点简介不能超过 2000 字符")
	}
	if input.SiteKind == "" {
		input.SiteKind = "knowledge"
	}
	if input.SiteKind != "knowledge" && input.SiteKind != "handbook" && input.SiteKind != "help" {
		return Config{}, fault.Field("body.site_kind", "站点场景不正确")
	}
	if input.AccentColor == "" {
		input.AccentColor = DefaultAccent
	}
	if !regexp.MustCompile(`^#[0-9a-fA-F]{6}$`).MatchString(input.AccentColor) {
		return Config{}, fault.Field("body.accent_color", "主题色必须是六位十六进制颜色")
	}
	if input.Navigation == nil {
		input.Navigation = []Navigation{}
	}
	if len(input.Navigation) > MaxPages {
		return Config{}, fault.Field("body.navigation", "最多选择 200 篇页面")
	}
	ids, slugs := map[string]bool{}, map[string]bool{}
	for i := range input.Navigation {
		item := &input.Navigation[i]
		item.Title = strings.TrimSpace(item.Title)
		if !ValidID(item.DocumentID) || !ValidPageSlug(item.Slug) || !validText(item.Title, 1, 240) || ids[item.DocumentID] || slugs[item.Slug] {
			return Config{}, fault.Field("body.navigation", "页面文档、标题或路径无效，文档与路径不能重复")
		}
		ids[item.DocumentID], slugs[item.Slug] = true, true
		if item.Group != nil {
			value := strings.TrimSpace(*item.Group)
			if !validText(value, 0, 120) {
				return Config{}, fault.Field("body.navigation", "页面分组名称不正确")
			}
			if value == "" {
				item.Group = nil
			} else {
				item.Group = &value
			}
		}
	}
	source := &input.Source
	if source.Kind == "" {
		source.Kind = "manual"
	}
	if source.Collections == nil {
		source.Collections = []CollectionBinding{}
	}
	if source.ExcludedDocumentIDs == nil {
		source.ExcludedDocumentIDs = []string{}
	}
	if source.PageOverrides == nil {
		source.PageOverrides = []Override{}
	}
	if (source.Kind != "manual" && source.Kind != "collections") || (source.Kind == "manual" && len(source.Collections) > 0) || (source.Kind == "collections" && len(source.Collections) == 0) || len(source.Collections) > MaxPages {
		return Config{}, fault.Field("body.source", "来源模式或文集绑定不正确")
	}
	seen := map[string]bool{}
	for i := range source.Collections {
		item := &source.Collections[i]
		key := item.CollectionID
		if item.RootDocumentID != nil {
			key += "/" + *item.RootDocumentID
			if !ValidID(*item.RootDocumentID) {
				return Config{}, fault.Field("body.source.collections", "根文档 ID 不正确")
			}
		}
		if !ValidID(item.CollectionID) || seen[key] {
			return Config{}, fault.Field("body.source.collections", "来源文集 ID 无效或重复")
		}
		seen[key] = true
		if item.Label != nil {
			value := strings.TrimSpace(*item.Label)
			if !validText(value, 0, 160) {
				return Config{}, fault.Field("body.source.collections", "来源标签最多 160 字符")
			}
			if value == "" {
				item.Label = nil
			} else {
				item.Label = &value
			}
		}
	}
	if len(source.ExcludedDocumentIDs) > MaxSourceRules || len(source.PageOverrides) > MaxPages {
		return Config{}, fault.Field("body.source", "来源排除或覆盖规则超出限制")
	}
	seen = map[string]bool{}
	for _, id := range source.ExcludedDocumentIDs {
		if !ValidID(id) || seen[id] {
			return Config{}, fault.Field("body.source.excluded_document_ids", "排除文档 ID 无效或重复")
		}
		seen[id] = true
	}
	seen = map[string]bool{}
	for i := range source.PageOverrides {
		item := &source.PageOverrides[i]
		if !ValidID(item.DocumentID) || seen[item.DocumentID] {
			return Config{}, fault.Field("body.source.page_overrides", "覆盖文档 ID 无效或重复")
		}
		seen[item.DocumentID] = true
		for _, entry := range []struct {
			value **string
			limit int
		}{{&item.Title, 240}, {&item.Description, 2000}} {
			if *entry.value != nil {
				value := strings.TrimSpace(**entry.value)
				if !validText(value, 0, entry.limit) {
					return Config{}, fault.Field("body.source.page_overrides", "页面覆盖文本超出限制")
				}
				if value == "" {
					*entry.value = nil
				} else {
					*entry.value = &value
				}
			}
		}
		if item.Slug != nil && !ValidPageSlug(*item.Slug) {
			return Config{}, fault.Field("body.source.page_overrides", "覆盖页面路径不正确")
		}
	}
	branding := &input.Branding
	if branding.Links == nil {
		branding.Links = []Link{}
	}
	if branding.FooterLinks == nil {
		branding.FooterLinks = []Link{}
	}
	if branding.Theme == "" {
		branding.Theme = "system"
	}
	if branding.Theme != "system" && branding.Theme != "light" && branding.Theme != "dark" {
		return Config{}, fault.Field("body.branding.theme", "阅读主题不正确")
	}
	if len(branding.Links) > MaxLinks || len(branding.FooterLinks) > MaxLinks {
		return Config{}, fault.Field("body.branding", "最多配置 20 个链接")
	}
	validateLink := func(link *Link) error {
		link.Label = strings.TrimSpace(link.Label)
		if !validText(link.Label, 1, 80) || len(link.URL) > 2048 || !document.SafeLink(link.URL) {
			return fault.Field("body.branding", "品牌链接不正确")
		}
		return nil
	}
	for _, links := range [][]Link{branding.Links, branding.FooterLinks} {
		for i := range links {
			if err := validateLink(&links[i]); err != nil {
				return Config{}, err
			}
		}
	}
	if branding.CTA != nil {
		if err := validateLink(branding.CTA); err != nil {
			return Config{}, err
		}
	}
	if logo := branding.Logo; logo != nil {
		if (logo.Type == "asset" && (!ValidID(logo.AssetID) || logo.URL != "")) || (logo.Type == "external" && (logo.AssetID != "" || !document.SafeLink(logo.URL) || !publicMediaURL(logo.URL))) || (logo.Type != "asset" && logo.Type != "external") {
			return Config{}, fault.Field("body.branding.logo", "品牌图片来源不正确")
		}
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return Config{}, err
	}
	if len(encoded) > MaxConfigBytes {
		return Config{}, fault.New(fault.TooLarge, "SITE_CONFIG_TOO_LARGE", "站点配置不能超过 2 MiB")
	}
	return input, nil
}

func publicMediaURL(value string) bool {
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return true
	}
	for _, prefix := range []string{"/s/", "/api/v1/public/sites/", "/public/sites/"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}
