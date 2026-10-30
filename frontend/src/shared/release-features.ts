/** Release-specific frontend entry points. Deferred features retain their data and APIs. */
export const releaseFeatures: Record<"documentSharing" | "documentFavorites" | "documentCollaboration" | "sites" | "sheetForms" | "boardCreation", boolean> = {
  documentSharing: false,
  documentFavorites: true,
  documentCollaboration: false,
  sites: false,
  sheetForms: false,
  boardCreation: false,
};
