import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ContentRenderer, contentOutline } from "./ContentRenderer";

afterEach(cleanup);

it("uses the original public heading path after an empty media block is filtered", () => {
  const blocks = { schema_version: 2, editor: "blocknote", blocks: [{ id: "public-1", type: "heading", props: { level: 2 }, content: "Same title", children: [] }] };
  const { container } = render(<ContentRenderer blocks={blocks} pageTitle="Same title" />);
  expect(container.querySelector("h2")).toHaveAttribute("id", "heading-1");
  expect(contentOutline(blocks, "Same title")).toEqual([{ id: "heading-1", text: "Same title", level: 2 }]);
});

it("keeps explicit column and media widths in public content", () => {
  const { container } = render(<ContentRenderer blocks={{ schema_version: 2, editor: "blocknote", blocks: [
    { id: "public-0", type: "table", props: {}, content: { type: "tableContent", columnWidths: [160, 220], rows: [{ cells: ["A", "B"] }] }, children: [] },
    { id: "public-1", type: "image", props: { url: "https://example.com/image.png", name: "diagram", previewWidth: 320 }, content: [], children: [] },
  ] }} />);
  expect(container.querySelector("table")).toHaveStyle({ width: "380px" });
  expect(container.querySelector("col")).toHaveStyle({ width: "160px" });
  expect(container.querySelector("figure")).toHaveStyle({ width: "320px", maxWidth: "100%" });
});
