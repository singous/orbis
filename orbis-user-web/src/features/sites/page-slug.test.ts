import { describe, expect, it } from "vitest";

import { createPageSlug, MAX_PAGE_SLUG_LENGTH } from "./page-slug";

describe("public page slug defaults", () => {
  it("uses readable ASCII title text", () => {
    expect(createPageSlug("  Café / Getting STARTED!  ", [])).toBe("cafe-getting-started");
  });

  it("uses the first available public page counter for non-ASCII or empty titles", () => {
    expect(createPageSlug("开始使用", ["page-1", "page-3"])).toBe("page-2");
    expect(createPageSlug("---", [])).toBe("page-1");
  });

  it("avoids existing defaults and custom paths without mutating them", () => {
    const existing = ["quick-start", "quick-start-2", "my-custom-path"];
    expect(createPageSlug("Quick Start", existing)).toBe("quick-start-3");
    expect(existing).toEqual(["quick-start", "quick-start-2", "my-custom-path"]);
  });

  it("keeps truncated titles and collision suffixes within the public path limit", () => {
    const title = "a".repeat(MAX_PAGE_SLUG_LENGTH + 20);
    const first = createPageSlug(title, []);
    const second = createPageSlug(title, [first]);
    const third = createPageSlug(title, [first, second]);
    expect(first).toHaveLength(MAX_PAGE_SLUG_LENGTH);
    expect(second).toBe(`${"a".repeat(MAX_PAGE_SLUG_LENGTH - 2)}-2`);
    expect(third).toBe(`${"a".repeat(MAX_PAGE_SLUG_LENGTH - 2)}-3`);
  });
});
