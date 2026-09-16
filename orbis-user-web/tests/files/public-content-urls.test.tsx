import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ContentRenderer } from "../../src/features/content/ContentRenderer";

afterEach(cleanup);

it("renders generated public paths without permitting arbitrary private or relative URLs", () => {
  const publicAsset = `/public/sites/guide/assets/${"a".repeat(64)}`;
  const values = [publicAsset, "/files/0190a111-1111-7111-8111-111111111111/content", "/public/sites/guide/assets/../private", "blob:https://example.com/untrusted", "orbis-file:0190a111-1111-7111-8111-111111111111"];
  const links = ["/s/guide/api/get-notes#heading-1", "/documents/private-note", "/s/guide/../settings", "//example.com/private"];
  render(<ContentRenderer blocks={{ schema_version: 2, blocks: [
    ...values.map((url, index) => ({ type: "image", props: { url, name: `image-${index}` }, content: [], children: [] })),
    { type: "paragraph", content: links.map((href, index) => ({ type: "link", href, content: [{ type: "text", text: `link-${index}` }] })), children: [] },
  ] }} />);
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "image-0" })).toHaveAttribute("src", publicAsset);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "link-0" })).toHaveAttribute("href", links[0]);
});
