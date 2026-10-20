import { createContext, useContext, useState, type ReactNode } from "react";

const EditorToolbarHostContext = createContext<HTMLElement | null>(null);

/** Editors outside a document shell keep their inline toolbar fallback. */
export function useEditorToolbarHost(): HTMLElement | null {
  return useContext(EditorToolbarHostContext);
}

/** The host remains mounted while the document scrolls and selection changes. */
export function EditorToolbarFrame({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <EditorToolbarHostContext.Provider value={host}>
      <div className="document-format-host" ref={setHost} />
      <div className="document-scroll-region" data-document-scroll="true">{children}</div>
    </EditorToolbarHostContext.Provider>
  );
}
