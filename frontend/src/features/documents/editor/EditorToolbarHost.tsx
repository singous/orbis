import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const EditorToolbarHostContext = createContext<{ format: HTMLElement | null; outline: HTMLElement | null }>({ format: null, outline: null });

/** Editors outside a document shell keep their inline toolbar fallback. */
export function useEditorToolbarHost(): HTMLElement | null {
  return useContext(EditorToolbarHostContext).format;
}

export function useEditorOutlineHost(): HTMLElement | null {
  return useContext(EditorToolbarHostContext).outline;
}

/** The host remains mounted while the document scrolls and selection changes. */
export function EditorToolbarFrame({ children }: { children: ReactNode }) {
  const [format, setFormat] = useState<HTMLDivElement | null>(null);
  const [outline, setOutline] = useState<HTMLDivElement | null>(null);
  const slots = useMemo(() => ({ format, outline }), [format, outline]);
  return (
    <EditorToolbarHostContext.Provider value={slots}>
      <div className="document-format-bar relative z-[11] hidden min-w-0 flex-none items-center justify-between gap-2 bg-card has-[.document-format-host:not(:empty)]:flex min-[1025px]:has-[.document-outline-host:not(:empty)]:flex">
        <div className="document-format-host min-w-0 flex-1 empty:hidden" ref={setFormat} />
        <div className="document-outline-host ms-auto flex-none px-5 empty:hidden max-[1024px]:hidden" ref={setOutline} />
      </div>
      <div className="document-scroll-region min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] scroll-py-6" data-document-scroll="true">{children}</div>
    </EditorToolbarHostContext.Provider>
  );
}
