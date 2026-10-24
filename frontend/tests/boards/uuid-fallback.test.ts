import { afterEach, expect, it, vi } from "vitest";
import { makeElement } from "../../src/features/boards/model";
import { cloneElements, TEMPLATES } from "../../src/features/boards/templates";

afterEach(() => vi.unstubAllGlobals());

it("creates board elements, templates and cloned identities on trusted HTTP origins", () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const element = makeElement("flow.process", "page", 0, 0);
  const template = TEMPLATES[0].build("page");
  const cloned = cloneElements([element], "page", 10, 20);
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(element.id).toMatch(uuidV4);
  expect(template.length).toBeGreaterThan(0);
  expect(template.every(value => uuidV4.test(value.id))).toBe(true);
  expect(cloned[0].id).toMatch(uuidV4);
  expect(cloned[0].id).not.toBe(element.id);
});
