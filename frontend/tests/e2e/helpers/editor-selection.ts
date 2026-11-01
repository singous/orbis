import { expect, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

export async function settleNativeEditorSelection(page: Page) {
  // 原生 Home/End 先移动 DOM 光标，selectionchange 随后才更新 ProseMirror 的命令位置。
  await expect.poll(() => page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    const selection = window.getSelection();
    if (!selection?.anchorNode || !selection.focusNode || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;
    return {
      anchor: editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset) - editor.state.selection.anchor,
      head: editor.view.posAtDOM(selection.focusNode, selection.focusOffset) - editor.state.selection.head,
    };
  })).toEqual({ anchor: 0, head: 0 });
}
