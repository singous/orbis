import { z } from "zod";
import { pageDataSchema } from "../../shared/api/schemas";

export const siteKindSchema = z.enum(["knowledge", "handbook", "help"]);
export type SiteKind = z.infer<typeof siteKindSchema>;
export const SITE_KINDS: Record<SiteKind, { label: string; description: string }> = {
  knowledge: { label: "知识站", description: "整理个人知识，分享思考与实践。" },
  handbook: { label: "产品手册", description: "用清晰的指南，让产品更容易使用。" },
  help: { label: "帮助中心", description: "集中常见问题，让读者快速找到答案。" },
};

export const navigationItemSchema = z.object({ note_id: z.string(), slug: z.string(), title: z.string(), group: z.string().nullable() });
export const notebookSourceSchema = z.object({
  notebook_id: z.string(),
  root_note_id: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});
export const sitePageOverrideSchema = z.object({
  note_id: z.string(),
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export const siteSourceSchema = z.object({
  kind: z.enum(["manual", "notebooks"]),
  notebooks: z.array(notebookSourceSchema),
  excluded_note_ids: z.array(z.string()),
  page_overrides: z.array(sitePageOverrideSchema),
});
export const siteBrandingSchema = z.object({
  logo_url: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  footer_links: z.array(z.object({ label: z.string(), url: z.string() })),
  cta: z.object({ label: z.string(), url: z.string() }).nullable(),
  theme: z.enum(["system", "light", "dark"]),
});
export const siteConfigSchema = z.object({
  name: z.string(), slug: z.string(), description: z.string(), site_kind: siteKindSchema,
  accent_color: z.string(), navigation: z.array(navigationItemSchema), source: siteSourceSchema.optional(), branding: siteBrandingSchema.optional(),
});
export const siteSchema = siteConfigSchema.extend({
  id: z.string(), config_version: z.number(), published_release_id: z.string().nullable(), published_slug: z.string().nullable(),
  created_at_ms: z.number(), updated_at_ms: z.number(),
});
export const publicPageSchema = z.object({
  slug: z.string(), title: z.string(), group: z.string().nullable(), blocks: z.record(z.unknown()), plain_text: z.string(),
  parent_slug: z.string().nullable().optional(), section: z.string().nullable().optional(),
  description: z.string().optional(), updated_at_ms: z.number().nullable().optional(),
});
export const siteSnapshotSchema = siteConfigSchema.omit({ navigation: true, source: true }).extend({
  pages: z.array(publicPageSchema), release_id: z.string().nullable(),
  release_number: z.number().nullable(), published_at_ms: z.number().nullable(),
  redirects: z.record(z.string()).optional(),
});
export const sitePreviewSchema = siteSnapshotSchema.extend({ source_fingerprint: z.string() });
export const sourcePageSchema = z.object({
  note_id: z.string(), slug: z.string(), title: z.string(), group: z.string().nullable(),
  parent_slug: z.string().nullable(), section: z.string().nullable(), description: z.string(), updated_at_ms: z.number().nullable(),
});
export const siteChangePageSchema = sourcePageSchema.extend({ note_id: z.string().nullable() });
export const siteChangesSchema = z.object({
  added: z.array(siteChangePageSchema),
  modified: z.array(siteChangePageSchema),
  removed: z.array(siteChangePageSchema),
});
export const siteSourcesSchema = z.object({
  pages: z.array(sourcePageSchema),
  excluded_count: z.number(),
  source_fingerprint: z.string(),
  changes: siteChangesSchema,
});
export const siteReleaseSchema = z.object({ id: z.string(), release_number: z.number(), published_at_ms: z.number(), is_active: z.boolean() });
export const siteListSchema = pageDataSchema(siteSchema);
export const siteReleaseListSchema = pageDataSchema(siteReleaseSchema);
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type Site = z.infer<typeof siteSchema>;
export type SiteSnapshot = z.infer<typeof siteSnapshotSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
export type SiteBranding = z.infer<typeof siteBrandingSchema>;
export type PublishedPage = z.infer<typeof publicPageSchema>;
export type SiteSource = z.infer<typeof siteSourceSchema>;
export type NotebookSource = z.infer<typeof notebookSourceSchema>;
export type SitePageOverride = z.infer<typeof sitePageOverrideSchema>;
export type SitePreview = z.infer<typeof sitePreviewSchema>;
export type SiteSources = z.infer<typeof siteSourcesSchema>;
export type SiteChangePage = z.infer<typeof siteChangePageSchema>;
