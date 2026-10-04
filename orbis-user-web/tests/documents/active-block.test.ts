import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { activeBlockKey, OrbisActiveBlock } from "../../src/features/notes/tiptap-active-block";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

it("renders only the caret's nested block path and leaves authored attributes untouched", () => {
  editor = new Editor({
    extensions: [StarterKit, OrbisActiveBlock],
    content: "<p>First</p><blockquote><p>Nested</p><p>Sibling</p></blockquote><p>Tail</p>",
  });
  const initial = editor.getJSON();
  editor.commands.setTextSelection(10);
  const decorations = activeBlockKey.getState(editor.state)!.find();
  expect(decorations).toHaveLength(2);
  expect(decorations.map(item => editor!.state.doc.nodeAt(item.from)!.type.name)).toEqual(["blockquote", "paragraph"]);
  expect(editor.getJSON()).toEqual(initial);
  expect(editor.view.dom.querySelectorAll(".orbis-editing-block")).toHaveLength(2);
  editor.commands.insertContent("edit ");
  expect(activeBlockKey.getState(editor.state)!.find()).toHaveLength(2);
  expect(editor.getJSON().content?.[1].content?.[1].content?.[0].text).toBe("Sibling");
  expect(JSON.stringify(editor.getJSON())).not.toContain("orbis-editing-block");
});

it("moves the rendered path with the selection and preserves unrelated paragraphs", () => {
  editor = new Editor({ extensions: [StarterKit, OrbisActiveBlock], content: "<p>First</p><p>Last</p>" });
  editor.commands.setTextSelection(9);
  expect(editor.view.dom.querySelectorAll(".orbis-editing-block")).toHaveLength(1);
  expect(editor.view.dom.querySelector(".orbis-editing-block")?.textContent).toBe("Last");
  editor.commands.insertContent("new ");
  expect(editor.view.dom.firstChild?.textContent).toBe("First");
  expect(editor.view.dom.lastChild?.textContent).toBe("Lnew ast");
});
