import { expect, test } from "@playwright/test";

test("focusing a scroll region does not restyle every document descendant", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "登录 Orbis" }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const scroller = document.createElement("div");
    scroller.id = "scrollbar-performance";
    scroller.style.cssText = "position:fixed;left:100px;top:100px;width:200px;height:200px;overflow:auto;background:white;z-index:100";
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Scroll region focus");
    scroller.append(input);
    for (let index = 0; index < 5000; index++) {
      const row = document.createElement("p");
      row.textContent = `Document paragraph ${index}`;
      scroller.append(row);
    }
    document.body.append(scroller);
    scroller.getBoundingClientRect();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReturnAsStream" });
  await page.getByRole("textbox", { name: "Scroll region focus" }).focus();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const finished = new Promise<{ stream: string }>((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  const { stream } = await finished;
  let trace = "";
  for (;;) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  const events = JSON.parse(trace).traceEvents as Array<{ name: string; args?: { elementCount?: number } }>;
  const restyled = events.filter((event) => event.name === "UpdateLayoutTree").map((event) => event.args?.elementCount ?? 0);
  await info.attach("restyled-elements.json", { body: JSON.stringify(restyled), contentType: "application/json" });
  expect(restyled.length).toBeGreaterThan(0);
  // Focus may update ancestors and controls, but must not invalidate 5000 rows.
  expect(Math.max(...restyled)).toBeLessThan(200);
  await expect(page.getByRole("textbox", { name: "Scroll region focus" })).toBeFocused();
});
