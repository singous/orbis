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
      <div className="document-format-host relative z-[11] min-w-0 flex-none border-b border-border bg-card empty:hidden" ref={setHost} />
      <div className="document-scroll-region min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] scroll-py-6" data-document-scroll="true">{children}</div>
    </EditorToolbarHostContext.Provider>
  );
}
