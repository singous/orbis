import { z } from "zod";
import { publicPageSchema, siteSnapshotSchema } from "./schemas";

export const publicPageMetadataSchema = publicPageSchema.pick({ slug: true, title: true, group: true, parent_slug: true, section: true, description: true, updated_at_ms: true });
export const siteManifestSchema = siteSnapshotSchema.extend({ pages: z.array(publicPageMetadataSchema), canonical_base_url: z.string().url().optional() });
export const publicPageDeliverySchema = z.object({ release_id: z.string().nullable(), page: publicPageSchema });
export const publicSearchSchema = z.object({ release_id: z.string().nullable(), pages: z.array(publicPageMetadataSchema.extend({ plain_text: z.string() })) });
export const siteBootstrapSchema = z.object({ manifest: siteManifestSchema, page: publicPageDeliverySchema });
export type SiteManifest = z.infer<typeof siteManifestSchema>;
export type PublicPageDelivery = z.infer<typeof publicPageDeliverySchema>;
export type SiteBootstrap = z.infer<typeof siteBootstrapSchema>;

export function readSiteBootstrap(): SiteBootstrap | null {
  const element = document.getElementById("orbis-site-bootstrap");
  if (!element) return null;
  try {
    const result = siteBootstrapSchema.safeParse(JSON.parse(element.textContent || ""));
    if (!result.success || result.data.manifest.release_id !== result.data.page.release_id || !result.data.manifest.pages.some((page) => page.slug === result.data.page.page.slug)) return null;
    return result.data;
  } catch { return null; }
}
