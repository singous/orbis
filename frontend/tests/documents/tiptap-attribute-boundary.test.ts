import { mergeAttributes } from "@tiptap/core";
import { DOMSerializer, Schema } from "@tiptap/pm/model";
import { expect, it } from "vitest";
import { clipboardProps } from "../../src/features/documents/editor/tiptap-clipboard";

it("keeps JSON-origin prototype keys as own data without inherited DOM attributes", () => {
  const input: Record<string, unknown> = JSON.parse('{"__proto__":{"data-inherited-canary":"unexpected"}}');
  const attrs = mergeAttributes(input);
  expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  expect(Object.hasOwn(attrs, "__proto__")).toBe(true);
  const schema = new Schema({ nodes: {
    doc: { content: "paragraph" },
    paragraph: { content: "text*", toDOM: () => ["p", attrs, 0] },
    text: {},
  } });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("safe"))]);
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  expect((fragment.firstChild as HTMLElement).hasAttribute("data-inherited-canary")).toBe(false);
});

it("exports only allowed authored properties at the editor clipboard boundary", () => {
  const props: unknown = JSON.parse('{"title":"Example","__proto__":{"data-inherited-canary":"unexpected"},"onclick":"unused","textAlignment":"left"}');
  expect(clipboardProps(props)).toEqual({ title: "Example", textAlignment: "left" });
});
