import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const readerScript = readFileSync(resolve(process.cwd(), "../internal/publishing/reader/reader.js"), "utf8");
const listeners: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = [];
afterEach(() => {
  for (const { type, listener } of listeners.splice(0)) document.removeEventListener(type, listener);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the server-rendered kanban column order when public records are paged", async () => {
  document.body.innerHTML = '<section data-table-url="/api/v1/public/sites/example/tables/table/records?release_id=fixed" data-page="1"><div data-records class="board"><section><h4>未分组 (2)</h4></section><section><h4>待办 (2)</h4></section></div><button data-table-page="-1" disabled>上一页</button><span data-table-status></span><button data-table-page="1">下一页</button></section>';
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "OK", data: {
    view: { kind: "kanban", group_field_id: "state" },
    fields: [{ id: "state", name: "状态", kind: "select", options: [{ id: "todo", label: "待办" }] }],
    groups: [{ option_id: null, name: "未分组", count: 2 }, { option_id: "todo", name: "待办", count: 2 }],
    items: [{ id: "row", values: { state: "todo" } }], pagination: { total: 201 },
  } }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const addEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    listeners.push({ type, listener });
    addEventListener(type, listener, options);
  });
  // Execute the actual independently served browser asset, including its click/fetch path.
  new Function(readerScript)();
  document.querySelector<HTMLButtonElement>('[data-table-page="1"]')!.click();
  await waitFor(() => expect(document.querySelector('[data-table-status]')).toHaveTextContent("第 2 页，共 201 条"));
  expect([...document.querySelectorAll(".board-column h4")].map(element => element.textContent)).toEqual(["未分组 (2)", "待办 (2)"]);
  expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), { credentials: "omit", headers: { Accept: "application/json" } });
  const url = fetchMock.mock.calls[0][0] as URL;
  expect(url.searchParams.get("release_id")).toBe("fixed");
  expect(url.searchParams.get("page")).toBe("2");
});
