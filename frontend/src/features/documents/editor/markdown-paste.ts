import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { looksLikeMarkdown, markdownToTiptapDoc } from "../../content/codecs/markdown";
import { fromTiptapDocument, toTiptapDocumentForSchema } from "./tiptap-model";

const plainPaste = new WeakMap<EditorView, boolean>();

/** Shared with the block-selection clipboard, which runs before native paste. */
export function plainTextPasteRequested(view: EditorView): boolean {
  return plainPaste.get(view) ?? false;
}

export function markdownClipboardDocument(text: string) {
  if (!looksLikeMarkdown(text)) return null;
  try {
    return markdownToTiptapDoc(text);
  } catch {
    // Keep the browser's literal-text fallback when parsing cannot complete.
    return null;
  }
}

/** HTML copied from a code sample still represents Markdown source. Ordinary
 * rendered HTML keeps its existing rich-content paste path. */
export function markdownSourceClipboard(data: Pick<DataTransfer, "getData">, document: Document): string | null {
  const text = data.getData("text/plain");
  if (!text) return null;
  const html = data.getData("text/html");
  if (!html) return text;
  const root = document.createElement("div");
  root.innerHTML = html;
  if (root.querySelector("[data-pm-slice], [data-orbis-block-clipboard], [data-orbis-block-id]")) return null;
  const source = root.querySelector("pre") ?? Array.from(root.querySelectorAll<HTMLElement>("[style]")).find(element =>
    ["pre", "pre-wrap", "break-spaces"].includes(element.style.whiteSpace) && /monospace|consolas|menlo|monaco|courier/i.test(element.style.fontFamily));
  if (!source || root.querySelectorAll("pre").length > 1) return null;
  const code = source.matches("code") ? source : source.querySelector("code");
  const language = code?.getAttribute("data-language") ?? /(?:^|\s)language-([^\s]+)/.exec(code?.className ?? "")?.[1];
  if (language && !["md", "markdown", "mdown", "text", "txt", "plaintext"].includes(language.toLowerCase())) return null;
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const sourceText = (node: ChildNode): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes, sourceText).join("");
    return content + (["DIV", "P"].includes(node.tagName) && !content.endsWith("\n") ? "\n" : "");
  };
  if (normalize(source.textContent ?? "") !== normalize(text) && normalize(Array.from(source.childNodes, sourceText).join("")) !== normalize(text)) return null;
  source.remove();
  return root.textContent?.trim() ? null : text;
}

function insertPastedSlice(view: EditorView, slice: Slice) {
  view.dispatch(closeHistory(view.state.tr).replaceSelection(slice).scrollIntoView().setMeta("paste", true).setMeta("orbisMarkdownPaste", true).setMeta("preventAutolink", true));
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
}

/** Native text parsing and code blocks retain their context. Parsed Markdown
 * replaces the selection in one transaction and one undo step. */
export const OrbisMarkdownPaste = Extension.create({
  name: "orbisMarkdownPaste",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("orbisMarkdownPaste"),
      props: {
        handlePaste(view, event, slice) {
          if (!view.editable || view.composing || view.state.selection.$from.parent.type.spec.code || !event.clipboardData) return false;
          if (plainTextPasteRequested(view)) {
            if (!event.clipboardData.getData("text/plain")) return false;
            // Keep ProseMirror's native plain-text fitting while bypassing
            // inline paste rules that would consume literal Markdown markers.
            insertPastedSlice(view, slice);
            return true;
          }
          const text = markdownSourceClipboard(event.clipboardData, view.dom.ownerDocument);
          if (!text) return false;
          const parsed = markdownClipboardDocument(text);
          if (!parsed) return false;
          let doc: ProseMirrorNode;
          try {
            const parsedDoc = view.state.schema.nodeFromJSON(parsed);
            parsedDoc.check();
            // Allocate identities before insertion instead of appending one
            // setNodeMarkup step per new block on a long document paste.
            doc = view.state.schema.nodeFromJSON(toTiptapDocumentForSchema(fromTiptapDocument(parsedDoc), view.state.schema));
            doc.check();
          } catch {
            return false;
          }
          // The codec already interpreted supported Markdown. Reapplying input
          // rules could strip syntax from unsupported constructs kept as text.
          insertPastedSlice(view, new Slice(doc.content, 0, 0));
          return true;
        },
      },
      view(view) {
        const keydown = (event: KeyboardEvent) => {
          // Shift+Insert is regular paste; Ctrl/Cmd+Shift+V is literal text.
          plainPaste.set(view, event.shiftKey && event.key !== "Insert");
        };
        const keyup = (event: KeyboardEvent) => plainPaste.set(view, event.shiftKey);
        const blur = () => plainPaste.delete(view);
        view.dom.addEventListener("keydown", keydown, true);
        view.dom.addEventListener("keyup", keyup, true);
        view.dom.addEventListener("blur", blur, true);
        return { destroy() {
          view.dom.removeEventListener("keydown", keydown, true);
          view.dom.removeEventListener("keyup", keyup, true);
          view.dom.removeEventListener("blur", blur, true);
          plainPaste.delete(view);
        } };
      },
    })];
  },
});
