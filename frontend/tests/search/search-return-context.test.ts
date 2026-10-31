import { afterEach, expect, it } from "vitest";
import { captureSearchReturnContext } from "../../src/features/search/search-return-context";

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); });
function searchButton() {
  const button = document.createElement("button");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-label", "搜索");
  document.body.append(button);
  return button;
}
it("does not move focus away from another control when a search trigger was replaced", () => {
  const old = searchButton();
  old.focus();
  const restore = captureSearchReturnContext();
  old.remove();
  const replacement = searchButton();
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  restore();
  expect(input).toHaveFocus();
  expect(replacement).not.toHaveFocus();
});
it("does not substitute a search button for a disconnected editor", () => {
  const editor = document.createElement("textarea");
  document.body.append(editor);
  editor.focus();
  const restore = captureSearchReturnContext();
  editor.remove();
  const replacement = searchButton();
  restore();
  expect(replacement).not.toHaveFocus();
  expect(document.body).toHaveFocus();
});
it("restores the surviving editor's exact selection and scroll position", () => {
  const editor = document.createElement("div");
  editor.tabIndex = 0;
  editor.contentEditable = "true";
  editor.textContent = "保留编辑选区";
  document.body.append(editor);
  editor.focus();
  const range = document.createRange();
  range.setStart(editor.firstChild!, 1);
  range.setEnd(editor.firstChild!, 4);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  editor.scrollTop = 48;
  const restore = captureSearchReturnContext();
  const overlay = document.createElement("input");
  document.body.append(overlay);
  overlay.focus();
  window.getSelection()!.removeAllRanges();
  overlay.remove();
  editor.scrollTop = 0;
  restore();
  expect(editor).toHaveFocus();
  expect(editor.scrollTop).toBe(48);
  expect(window.getSelection()!.getRangeAt(0).startOffset).toBe(1);
  expect(window.getSelection()!.getRangeAt(0).endOffset).toBe(4);
});
