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
  await expect(page.getByRole("button", { name: "写篇文档", exact: true })).toHaveCSS("min-height", "55px");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectHomeControlScale(page);
});
