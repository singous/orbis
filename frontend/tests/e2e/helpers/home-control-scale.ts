import { expect, type Page } from "@playwright/test";

export async function expectHomeControlScale(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished));
  });
  const metrics = await page.evaluate(() => {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const selectors = [
      ".home-welcome-actions button", ".home-note-actions > button:first-child",
      ".home-note-actions > button:last-child", '.home-note-actions [data-slot="popover-trigger"]',
      ".home-search button[type=submit]", ".home-note-composer .quick-note-tools button",
    ];
    const controls = selectors.map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { selector, height: box.height, width: box.width, font: parseFloat(style.fontSize), x: box.x, right: box.right };
    });
    const search = document.querySelector<HTMLElement>(".home-search")!;
    return { rootFontSize, controls, searchOverflow: search.scrollWidth > search.clientWidth, viewport: innerWidth };
  });
  for (const control of metrics.controls) {
    expect(control.height, control.selector).toBeGreaterThanOrEqual(metrics.rootFontSize * 1.5);
    expect(control.width, control.selector).toBeGreaterThan(0);
    expect(control.font, control.selector).toBeGreaterThanOrEqual(metrics.rootFontSize * .75);
    expect(control.x, control.selector).toBeGreaterThanOrEqual(0);
    expect(control.right, control.selector).toBeLessThanOrEqual(metrics.viewport);
  }
  expect(metrics.searchOverflow).toBe(false);
}
