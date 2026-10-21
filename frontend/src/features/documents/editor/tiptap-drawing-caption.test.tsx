import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingEditorProps } from "../../drawing/DrawingEditorDialog";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import { OrbisDrawing } from "./tiptap-drawing";

const files = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../../files/use-managed-files", () => ({ useManagedFiles: () => ({ scope: "drawing-caption-test", upload: files.upload }) }));
vi.mock("../../drawing/DrawingPreview", () => ({ DrawingPreview: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }));
vi.mock("../../drawing/DrawingEditorDialog", () => ({
  default: function RetainedDrawingDialog({ scene, caption, onSave, onClose }: DrawingEditorProps) {
    const [draft, setDraft] = useState(scene);
    const [error, setError] = useState<string | null>(null);
    async function save() {
      setError(null);
      try {
        await onSave({ scene: draft, caption, preview: new Blob(["synthetic drawing preview"], { type: "image/png" }) });
        onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); }
    }
    return <div role="dialog" aria-label="本机画板草稿">
      <textarea aria-label="本机绘制内容" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => void save()}>保存画板草稿</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>;
  },
}));

const BASE_SCENE = JSON.stringify({ version: 1, elements: [], appState: { viewBackgroundColor: "#ffffff" } });
const LOCAL_SCENE = JSON.stringify({ version: 1, elements: [{ id: "local-shape", type: "rectangle", x: 0, y: 0, width: 20, height: 20 }], appState: { viewBackgroundColor: "#ffffff" } });
const ORIGINAL_PREVIEW = "orbis-file:00000000-0000-4000-8000-000000000001";
const UPLOADED_PREVIEW = "orbis-file:00000000-0000-4000-8000-000000000002";
const editors: Editor[] = [];
beforeEach(() => { files.upload.mockReset().mockResolvedValue(UPLOADED_PREVIEW); });
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); });

async function open(caption: string | undefined) {
  const editor = new Editor({
    extensions: [StarterKit, OrbisDrawing],
    content: { type: "doc", content: [{ type: "orbisDrawing", attrs: { orbisId: "00000000-0000-4000-8000-000000000003", orbisProps: { scene: BASE_SCENE, caption, url: ORIGINAL_PREVIEW } } }] },
  });
  editors.push(editor);
  render(<EditorReadOnlyContext.Provider value={false}><EditorContent editor={editor} /></EditorReadOnlyContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "编辑画板" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "本机绘制内容" }), { target: { value: LOCAL_SCENE } });
  return editor;
}
function remoteCaption(editor: Editor, caption: string) {
  act(() => {
    const node = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, orbisProps: { ...node.attrs.orbisProps, caption } }));
  });
}

async function assertRetained(editor: Editor) {
  expect(await screen.findByRole("alert")).toHaveTextContent("正文中的画板已更新");
  expect(screen.getByRole("dialog", { name: "本机画板草稿" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "本机绘制内容" })).toHaveValue(LOCAL_SCENE);
  expect(editor.state.doc.firstChild!.attrs.orbisProps).toEqual({ scene: BASE_SCENE, caption: "远端标题", url: ORIGINAL_PREVIEW });
}

describe("drawing node view caption baseline", () => {
  it("preserves the local dialog draft and rejects a newer remote caption before uploading", async () => {
    const editor = await open("原始标题");
    remoteCaption(editor, "远端标题");
    fireEvent.click(screen.getByRole("button", { name: "保存画板草稿" }));
    await assertRetained(editor);
    expect(files.upload).not.toHaveBeenCalled();
  });

  it("checks the caption again after an in-flight upload and preserves both versions", async () => {
    let finishUpload!: (url: string) => void;
    files.upload.mockImplementationOnce(() => new Promise<string>(resolve => { finishUpload = resolve; }));
    const editor = await open("原始标题");
    fireEvent.click(screen.getByRole("button", { name: "保存画板草稿" }));
    await waitFor(() => expect(files.upload).toHaveBeenCalledTimes(1));
    remoteCaption(editor, "远端标题");
    await act(async () => { finishUpload(UPLOADED_PREVIEW); });
    await assertRetained(editor);
    expect(files.upload).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, ""])("keeps saving an unchanged normalized default caption (%s)", async caption => {
    const editor = await open(caption);
    fireEvent.click(screen.getByRole("button", { name: "保存画板草稿" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "本机画板草稿" })).not.toBeInTheDocument());
    expect(files.upload).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.firstChild!.attrs.orbisProps).toMatchObject({ scene: LOCAL_SCENE, caption: "画板", url: UPLOADED_PREVIEW });
  });
});
