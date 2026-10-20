import { describe, expect, it } from "vitest";

import { matchPaletteCategories, parsePaletteInput, SEARCH_PALETTE_CATEGORIES } from "./search-palette-model";

describe("palette resource categories", () => {
  it("lists only implemented resource types and their supported aliases", () => {
    expect(SEARCH_PALETTE_CATEGORIES.map(category => [category.type, category.alias])).toEqual([
      ["document", "@doc"], ["notebook", "@notebook"], ["group", "@group"], ["site", "@site"], ["file", "@file"],
    ]);
    expect(matchPaletteCategories("")).toEqual(SEARCH_PALETTE_CATEGORIES);
    expect(matchPaletteCategories("@")).toEqual(SEARCH_PALETTE_CATEGORIES);
    expect(matchPaletteCategories("@NO").map(category => category.type)).toEqual(["notebook"]);
    expect(matchPaletteCategories("附件").map(category => category.type)).toEqual(["file"]);
    expect(matchPaletteCategories("@plugin")).toEqual([]);
  });

  it.each(SEARCH_PALETTE_CATEGORIES)("selects $type with an exact leading $alias and preserves its keyword", (category) => {
    expect(parsePaletteInput(category.alias)).toEqual({ q: "", type: category.type, category, hasPrefix: true });
    expect(parsePaletteInput(`  ${category.alias.toUpperCase()}\t设计 规范  `)).toEqual({ q: "设计 规范", type: category.type, category, hasPrefix: true });
  });

  it.each(["@docs design", "@doc-name", "@doc/guide", "@plugin text", "someone@doc", "设计 @doc 规范", "@d"])("keeps unknown or nonleading aliases literal: %s", (input) => {
    expect(parsePaletteInput(` ${input} `)).toEqual({ q: input, type: "all", category: null, hasPrefix: false });
  });

  it("preserves additional @ terms and multiline text after a recognized prefix", () => {
    expect(parsePaletteInput("@doc @owner\n权限").q).toBe("@owner\n权限");
    expect(parsePaletteInput("   ")).toEqual({ q: "", type: "all", category: null, hasPrefix: false });
  });
});
