import { expect, test, type Page } from "@playwright/test";
import { PLAY_FUNCTION_THREW_EXCEPTION, STORY_FINISHED, STORY_THREW_EXCEPTION, type StoryFinishedPayload } from "storybook/internal/core-events";
import { STORYBOOK_ORIGIN, waitForStoryReady } from "./helpers/story-ready";

const storyId = "primitives-icons--catalog";
const content = "ready fixture content";
const playError = "ORBIS_INTENTIONAL_PLAY_ERROR";
const renderError = "ORBIS_INTENTIONAL_RENDER_ERROR";

async function openFixture(page: Page, mode: "pass" | "play" | "render") {
  const story = mode === "render" ? `render: () => { throw new Error("${renderError}"); }`
    : `render: () => "${content}", play: async ({ canvasElement }) => { canvasElement.dataset.readyFixture = "played"; ${mode === "play" ? `throw new Error("${playError}");` : ""} }`;
  let deliveries = 0;
  await page.route("**/src/icons/index.stories.tsx*", async route => {
    deliveries += 1;
    await route.fulfill({ contentType: "application/javascript", body: `export default { title: "Primitives/Icons" }; export const Catalog = { ${story} };` });
  });
  await page.goto(`${STORYBOOK_ORIGIN}/iframe.html?${new URLSearchParams({ id: storyId, viewMode: "story" })}`);
  return () => deliveries;
}

test("ready accepts a fresh successful Story and its completed play", async ({ page }) => {
  const deliveries = await openFixture(page, "pass");
  await waitForStoryReady(page, storyId);
  expect(deliveries()).toBeGreaterThan(0);
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await expect(page.locator("#storybook-root")).toHaveAttribute("data-ready-fixture", "played");
});

for (const mode of ["play", "render"] as const) test(`ready rejects a fresh ${mode} exception even when Storybook finishes successfully`, async ({ page }) => {
  const deliveries = await openFixture(page, mode);
  const terminal = await page.waitForFunction(({ storyId, event }) => {
    const channel = (window as Window & { __STORYBOOK_ADDONS_CHANNEL__?: { last: (event: string) => [StoryFinishedPayload] | undefined } }).__STORYBOOK_ADDONS_CHANNEL__;
    const finished = channel?.last(event)?.[0];
    return finished?.storyId === storyId ? finished : false;
  }, { storyId, event: STORY_FINISHED });
  expect(await terminal.jsonValue()).toMatchObject({ status: "success" });
  expect(deliveries()).toBeGreaterThan(0);
  if (mode === "play") await expect(page.getByText(content, { exact: true })).toBeVisible();
  const ready = waitForStoryReady(page, storyId);
  await expect(ready).rejects.toThrow(`Story ${storyId} failed before visual actions`);
  await expect(ready).rejects.toThrow(mode === "play" ? PLAY_FUNCTION_THREW_EXCEPTION : STORY_THREW_EXCEPTION);
  await expect(ready).rejects.toThrow(mode === "play" ? playError : renderError);
  await expect(ready).rejects.toThrow('"stack":');
  await expect(ready).rejects.toThrow("index.stories.tsx");
});
