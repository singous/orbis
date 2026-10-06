import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ContentRenderer } from "../../src/features/content/ContentRenderer";

it("renders published drawings without editing controls and enlarges their preview", () => {
  render(<ContentRenderer blocks={{ schema_version: 2, editor: "blocknote", blocks: [{ id: "public-drawing", type: "drawing", props: { url: "https://example.com/preview.png", caption: "系统草图" }, content: [], children: [] }] }} />);
  expect(screen.getByRole("img", { name: "系统草图" })).toHaveAttribute("src", "https://example.com/preview.png");
  expect(screen.queryByRole("button", { name: "编辑画板" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "放大查看画板" }));
  expect(screen.getByRole("dialog", { name: "系统草图" })).toBeInTheDocument();
});
