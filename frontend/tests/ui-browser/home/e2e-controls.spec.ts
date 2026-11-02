import { expect, test } from "@playwright/test";
import { expectHomeControlScale } from "../../e2e/helpers/home-control-scale";
import { installHomeFixture } from "../fixtures/home";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test("the home scale probe follows live themes and the user's font size", async ({ page }) => {
  await installHomeFixture(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/home");
  await expect(page.locator(".home-document-copy strong").first()).toBeVisible();
  await expectHomeControlScale(page);
  await page.locator("html").evaluate(element => { element.style.fontSize = "20px"; });
  await expectHomeControlScale(page);
  expect((await page.getByRole("button", { name: "写篇文档", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(30);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectHomeControlScale(page);
});

test("home tag controls open the native manager and leave attachment selection reachable", async ({ page }) => {
  await installHomeFixture(page);
  await page.goto("/home");
  const composer = page.getByRole("region", { name: "快速记录", exact: true });
  await composer.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByRole("dialog", { name: "标签选项", exact: true }).getByRole("button", { name: "管理标签", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理标签", exact: true });
  await expect(manager.getByRole("textbox", { name: "新标签名称", exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(manager).toBeHidden();
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "添加附件", exact: true }).click();
  expect(await chooser).toBeTruthy();
});
