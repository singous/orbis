import { cleanup, render, screen } from "@testing-library/react";
import { Editor, getSchema } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
import { ContentRenderer } from "../../src/features/content/ContentRenderer";
import { documentBlockDefinition } from "../../src/features/content/document-components";
import { extractPlainTextV2, v2ToMarkdown, type NoteBlocksV2, type OrbisBlock } from "../../src/features/notes/block-model";
import { TiptapEditor } from "../../src/features/notes/TiptapEditor";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { createDocumentBlock } from "../../src/features/notes/tiptap-insert";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";

const block = (id: string, type: string, children: OrbisBlock[] = [], text = ""): OrbisBlock => ({ id, type, props: {}, content: text ? [{ type: "text", text }] : [], children });
const children = [block("first", "paragraph", [], "First"), block("nested", "group", [block("heading", "heading", [], "Heading"), block("last", "paragraph", [], "Last")])];
const value: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [block("group", "group", children)] };
afterEach(cleanup);

it("declares a transparent container and creates it without synthetic children", () => {
  expect(documentBlockDefinition("group")).toMatchObject({ content: "none", children: "any", props: {} });
  expect(createDocumentBlock("group")).toMatchObject({ type: "group", props: {}, content: [], children: [] });
});

it("preserves nested IDs and ordering after editing, serializing and reloading a group", () => {
  const json = toTiptapDocument(value);
  const schema = getSchema(tiptapExtensions);
  expect(() => schema.nodeFromJSON(json).check()).not.toThrow();
  const editor = new Editor({ extensions: tiptapExtensions, content: json });
  try {
    let position = 0;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.orbisId === "first") position = pos + 1; });
    editor.commands.insertContentAt(position, "Edited ");
    const saved = fromTiptapDocument(editor.getJSON());
    expect(saved.blocks[0].type).toBe("group");
    expect(saved.blocks[0].children.map((item) => item.id)).toEqual(["first", "nested"]);
    expect(saved.blocks[0].children[1].children.map((item) => item.id)).toEqual(["heading", "last"]);
    expect(extractPlainTextV2(saved.blocks)).toBe("Edited First\nHeading\nLast");
    expect(fromTiptapDocument(toTiptapDocument(saved))).toEqual(saved);
  } finally { editor.destroy(); }
});

it("renders children without editor titles, icons or property controls", async () => {
  const { container } = render(<TiptapEditor blocks={value} onChange={() => {}} />);
  await screen.findByText("First");
  const group = container.querySelector('[data-document-component="group"]');
  expect(group).not.toBeNull();
  expect(group?.querySelector(".doc-editor-title, .doc-editor-heading, .doc-editor-settings, svg")).toBeNull();
  expect(group).not.toHaveClass("doc-editor-block");
});

it("renders nested public children transparently and exports the same Markdown as their ungrouped form", () => {
  const { container } = render(<ContentRenderer blocks={value} />);
  expect(container.querySelector("section, aside")).toBeNull();
  expect(screen.getByRole("heading", { name: "Heading" })).toHaveAttribute("id", "heading-0-1-0");
  expect(container.textContent).toBe("FirstHeadingLast");
  expect(v2ToMarkdown(value.blocks)).toBe(v2ToMarkdown([children[0], ...children[1].children]));
});


it("round trips nested group structure through safe clipboard HTML", () => {
  const source = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(value) });
  const pasted = new Editor({ extensions: tiptapExtensions, content: source.getHTML() });
  try {
    const result = fromTiptapDocument(pasted.getJSON());
    expect(result.blocks[0].type).toBe("group");
    expect(result.blocks[0].children.map((item) => item.type)).toEqual(["paragraph", "group"]);
    expect(extractPlainTextV2(result.blocks)).toBe("First\nHeading\nLast");
    expect(v2ToMarkdown(result.blocks)).toBe(v2ToMarkdown(value.blocks));
    expect(source.getHTML()).not.toContain("orbisOriginal");
  } finally { source.destroy(); pasted.destroy(); }
});
