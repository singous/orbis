import { releaseFeatures } from "../../shared/release-features";
import type { SearchType } from "./api";

export type SearchPaletteCategory = {
  type: SearchType;
  alias: string;
  label: string;
  description: string;
};

/** Every category maps to an implemented, permission-filtered search resource. */
const ALL_SEARCH_PALETTE_CATEGORIES: readonly SearchPaletteCategory[] = [
  { type: "document", alias: "@doc", label: "文档与评论", description: "搜索文档标题、已保存正文和评论" },
  { type: "notebook", alias: "@notebook", label: "笔记本", description: "按名称查找笔记本" },
  { type: "group", alias: "@group", label: "文档分组", description: "按名称查找文档分组" },
  { type: "site", alias: "@site", label: "站点", description: "搜索站点名称、描述和路径" },
  { type: "file", alias: "@file", label: "文件与附件", description: "搜索文件名与已有元数据" },
];
export const SEARCH_PALETTE_CATEGORIES = ALL_SEARCH_PALETTE_CATEGORIES.filter(category => releaseFeatures.sites || category.type !== "site");

export type ParsedPaletteInput = {
  q: string;
  type: SearchType | "all";
  category: SearchPaletteCategory | null;
  hasPrefix: boolean;
};

/** Only a complete leading alias is syntax; all other @ text remains literal. */
export function parsePaletteInput(input: string): ParsedPaletteInput {
  const trimmed = input.trim();
  const prefix = /^(@\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  const category = prefix ? SEARCH_PALETTE_CATEGORIES.find(item => item.alias === prefix[1].toLowerCase()) : undefined;
  if (!category) return { q: trimmed, type: "all", category: null, hasPrefix: false };
  return { q: (prefix?.[2] ?? "").trim(), type: category.type, category, hasPrefix: true };
}

/** Supports empty discovery, partial aliases, and Chinese category-name matching. */
export function matchPaletteCategories(input: string): readonly SearchPaletteCategory[] {
  const query = input.trim().toLowerCase();
  if (!query || query === "@") return SEARCH_PALETTE_CATEGORIES;
  return SEARCH_PALETTE_CATEGORIES.filter(category => category.alias.startsWith(query)
    || category.label.toLowerCase().includes(query)
    || category.description.toLowerCase().includes(query));
}
