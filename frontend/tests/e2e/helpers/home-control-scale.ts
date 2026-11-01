import { expect, type Page } from "@playwright/test";

export async function expectHomeControlScale(page: Page) {
  // 主题属性先更新，已挂载控件的颜色过渡随后完成；克隆参考应与同一稳定状态比较。
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished));
  });
  const sizes = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const tokenPixels = (token: string) => {
      const value = root.getPropertyValue(token).trim();
      return parseFloat(value) * (value.endsWith("rem") ? parseFloat(root.fontSize) : 1);
    };
    const height = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().height;
    const font = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
    // Compare the home control with the same shared component outside page styling.
    const appearance = (element: Element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderRadius, padding: style.padding, background: style.backgroundColor, color: style.color, font: style.fontSize };
    };
    const controls = [".home-welcome-actions button", ".home-note-actions > button:first-child", ".home-note-actions > button:last-child", ".home-note-actions summary", ".home-search button[type=submit]"].map(selector => {
      const control = document.querySelector(selector)!;
      const reference = control.cloneNode(false) as HTMLElement;
      document.body.append(reference);
      const pair = { selector, home: appearance(control), shared: appearance(reference) };
      reference.remove();
      return pair;
    });
    const result = {
      button: height(".home-welcome-actions button"), save: height(".home-note-actions > button:last-child"),
      attachment: height(".home-note-actions > button:first-child"), tag: height(".home-note-actions summary"),
      search: height(".home-search-group"), iconButton: height(".home-search button[type=submit]"), toolbar: height(".home-note-composer .quick-note-tools button"),
      title: font(".home-header h1"), section: font(".home-recent h2"), body: font(".home-document-copy strong"),
      expectedButton: tokenPixels("--ob-control-height-md"), expectedForm: tokenPixels("--ob-control-height-lg"), expectedCompact: tokenPixels("--ob-control-height-sm"),
      expectedTitle: tokenPixels("--ob-text-page-title-size"), expectedSection: tokenPixels("--ob-text-panel-title-size"), expectedBody: tokenPixels("--ob-text-ui-size"),
      controls,
    };
    return result;
  });
  for (const control of [sizes.button, sizes.save, sizes.attachment, sizes.tag]) expect(control).toBeCloseTo(sizes.expectedButton, 1);
  expect(sizes.search).toBeCloseTo(sizes.expectedForm, 1);
  expect(sizes.iconButton).toBeCloseTo(sizes.expectedCompact, 1);
  expect(sizes.toolbar).toBeCloseTo(sizes.expectedCompact, 1);
  expect(sizes.title).toBeCloseTo(sizes.expectedTitle, 1);
  expect(sizes.section).toBeCloseTo(sizes.expectedSection, 1);
  expect(sizes.body).toBeCloseTo(sizes.expectedBody, 1);
  for (const control of sizes.controls) expect(control.home, control.selector).toEqual(control.shared);
}
