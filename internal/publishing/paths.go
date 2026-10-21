package publishing

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"orbis.local/orbis/internal/platform/fault"
)

func pathConflict() error {
	return fault.New(fault.Validation, "SITE_PAGE_PATH_CONFLICT", "页面路径已被占用，请检查来源覆盖与历史路径")
}

// AssignPaths preserves automatic addresses and records aliases for explicit changes.
func AssignPaths(registry Registry, pages []PageSource, manual bool) ([]PageSource, Registry, map[string]string, error) {
	copyBytes, err := json.Marshal(registry)
	if err != nil {
		return nil, nil, nil, err
	}
	current := Registry{}
	if err := json.Unmarshal(copyBytes, &current); err != nil {
		return nil, nil, nil, err
	}
	if current == nil {
		current = Registry{}
	}
	owners := map[string]string{}
	if manual {
		claimed := map[string]bool{}
		for _, page := range pages {
			claimed[page.Slug] = true
		}
		next := Registry{}
		for _, page := range pages {
			old := current[page.DocumentID]
			aliases := append([]string{}, old.Aliases...)
			if old.Slug != "" {
				aliases = append(aliases, old.Slug)
			}
			kept := []string{}
			for _, alias := range aliases {
				if !claimed[alias] {
					kept = append(kept, alias)
				}
			}
			next[page.DocumentID] = PathEntry{Slug: page.Slug, Aliases: kept}
		}
		current = next
	}
	reserve := func(slug, id string) error {
		if owner, exists := owners[slug]; exists && owner != id {
			return pathConflict()
		}
		owners[slug] = id
		return nil
	}
	keys := make([]string, 0, len(current))
	for id := range current {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		entry := current[id]
		for _, slug := range append([]string{entry.Slug}, entry.Aliases...) {
			if err := reserve(slug, id); err != nil {
				return nil, nil, nil, err
			}
		}
	}
	for _, page := range pages {
		if page.Slug != "" {
			if err := reserve(page.Slug, page.DocumentID); err != nil {
				return nil, nil, nil, err
			}
		}
	}
	result := make([]PageSource, len(pages))
	copy(result, pages)
	selected := map[string]bool{}
	for i := range result {
		page := &result[i]
		old := current[page.DocumentID]
		value := page.Slug
		if value == "" {
			value = old.Slug
		}
		if value == "" {
			var stem strings.Builder
			for _, r := range strings.ToLower(page.Title) {
				if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
					stem.WriteRune(r)
				} else if stem.Len() > 0 && !strings.HasSuffix(stem.String(), "-") {
					stem.WriteByte('-')
				}
			}
			base := strings.Trim(stem.String(), "-")
			if len(base) > MaxPageSlug {
				base = strings.TrimRight(base[:MaxPageSlug], "-")
			}
			if base == "" {
				base = "page"
			}
			value = base
			for counter := 2; owners[value] != "" && owners[value] != page.DocumentID; counter++ {
				suffix := fmt.Sprintf("-%d", counter)
				value = strings.TrimRight(base[:min(len(base), MaxPageSlug-len(suffix))], "-") + suffix
			}
		}
		if err := reserve(value, page.DocumentID); err != nil {
			return nil, nil, nil, err
		}
		aliases := map[string]bool{}
		for _, alias := range old.Aliases {
			if alias != value {
				aliases[alias] = true
			}
		}
		if old.Slug != "" && old.Slug != value {
			aliases[old.Slug] = true
		}
		ordered := []string{}
		for alias := range aliases {
			ordered = append(ordered, alias)
		}
		sort.Strings(ordered)
		current[page.DocumentID] = PathEntry{Slug: value, Aliases: ordered}
		page.Slug = value
		selected[page.DocumentID] = true
	}
	redirects := map[string]string{}
	for id, entry := range current {
		if selected[id] {
			for _, alias := range entry.Aliases {
				redirects[alias] = entry.Slug
			}
		}
	}
	return result, current, redirects, nil
}
