import { Excalidraw, MainMenu, exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { parseDrawingScene, serializeDrawingScene } from "./drawing-scene";
import "@excalidraw/excalidraw/index.css";

// Served by Vite in development and copied into the production bundle.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: `${import.meta.env.BASE_URL}drawing-assets/` });
const PREVIEW_MAX_DIMENSION = 2400;
const UI_OPTIONS = { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, saveAsImage: false, export: false as const, toggleTheme: false } };

export type DrawingEditorProps = {
  scene: string;
  caption: string;
  onSave: (value: { scene: string; caption: string; preview: Blob | null }) => Promise<void>;
  onClose: () => void;
};

export default function DrawingEditorDialog({ scene, caption, onSave, onClose }: DrawingEditorProps) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const dirty = useRef(false);
  const alive = useRef(true);
  const [name, setName] = useState(caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [initial] = useState<ExcalidrawInitialDataState>(() => {
    const stored = parseDrawingScene(scene);
    return { elements: restoreElements(stored.elements as ExcalidrawElement[], null), appState: stored.appState, scrollToContent: true };
  });
  useEffect(() => {
    alive.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { alive.current = false; window.removeEventListener("beforeunload", beforeUnload); };
  }, []);

  const close = () => {
    if (saving) return;
    if (dirty.current) setDiscard(true); else onClose();
  };
  async function save() {
    if (!api.current || saving) return;
    setSaving(true); setError(null);
    try {
      const elements = api.current.getSceneElements();
      const appState = api.current.getAppState();
      const source = serializeDrawingScene(elements, appState.viewBackgroundColor);
      const preview = elements.length ? await exportToBlob({
        elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false }, files: {},
        maxWidthOrHeight: PREVIEW_MAX_DIMENSION, mimeType: "image/png",
      }) : null;
      if (!alive.current) return;
      await onSave({ scene: source, caption: name.trim() || "画板", preview });
      if (!alive.current) return;
      dirty.current = false;
      onClose();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "画板保存失败，绘制内容已保留，请重试。");
    } finally { if (alive.current) setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent title="编辑画板" className="drawing-editor-dialog" hideCloseButton>
    <div data-orbis-embedded-editor onKeyDown={event => event.stopPropagation()} onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}>
      <div className="drawing-editor-meta"><label>画板名称<input aria-label="画板名称" value={name} maxLength={200} disabled={saving} onChange={event => { dirty.current = true; setName(event.target.value); }} /></label><span>画笔 · 图形 · 箭头 · 文字</span></div>
      <div className="drawing-editor-surface" aria-label="绘图区域" onPointerDown={() => { dirty.current = true; }} onKeyDown={() => { dirty.current = true; }} style={saving ? { pointerEvents: "none" } : undefined}>
        <Excalidraw initialData={initial} excalidrawAPI={value => { api.current = value; }} langCode="zh-CN" theme="light" UIOptions={UI_OPTIONS} autoFocus handleKeyboardGlobally={false} aiEnabled={false} validateEmbeddable={false} viewModeEnabled={saving}>
          <MainMenu><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
        </Excalidraw>
      </div>
      {error ? <p className="drawing-error" role="alert">{error}</p> : null}
      {discard ? <div className="drawing-discard" role="alert"><span>本次绘制尚未保存，退出后将放弃这些修改。</span><ActionButton onClick={() => setDiscard(false)}>继续编辑</ActionButton><ActionButton onClick={onClose}>放弃修改</ActionButton></div> : null}
      <DialogFooter><ActionButton disabled={saving} onClick={close}>取消</ActionButton><ActionButton variant="primary" isPending={saving} onClick={() => void save()}>保存画板</ActionButton></DialogFooter>
    </div>
  </DialogContent></Dialog>;
}
