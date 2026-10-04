let editorModule: Promise<{ default: typeof import("../notes/TiptapEditor").TiptapEditor }> | undefined;

/** Share one module request between navigation intent and the editor boundary. */
export const loadDocumentEditor = () => editorModule ??= import("../notes/TiptapEditor").then(module => ({ default: module.TiptapEditor }));
