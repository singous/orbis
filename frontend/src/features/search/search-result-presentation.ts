import { releaseFeatures } from "../../shared/release-features";
import { BookOpen, FileText, Folder, Globe, Paperclip } from "../../shared/ui/icons";
import type { SearchResult } from "./api";

export const SEARCH_RESULT_ICONS = { document: FileText, notebook: BookOpen, group: Folder, site: Globe, file: Paperclip };

export function visibleSearchResults(items: SearchResult[]): SearchResult[] {
  return items.filter(item => releaseFeatures.sites || item.type !== "site");
}
