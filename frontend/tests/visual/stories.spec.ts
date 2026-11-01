import { expect, test, type Page } from "@playwright/test";
import { STORYBOOK_ORIGIN, waitForStoryReady } from "./helpers/story-ready";

type StoryCase = {
  name: string;
  id: string;
  prepare: (page: Page) => Promise<void>;
};

const stories: StoryCase[] = [
  { name: "avatar", id: "primitives-avatar--sizes", prepare: async page => {
    await expect(page.locator('[data-slot="ob-avatar"]')).toHaveCount(3);
    await expect(page.getByText("张", { exact: true })).toHaveCount(3);
  } },
  { name: "badge", id: "primitives-badge--tones", prepare: async page => {
    await expect(page.getByText("neutral", { exact: true })).toBeVisible();
    await expect(page.getByText("danger", { exact: true })).toBeVisible();
  } },
  { name: "button", id: "primitives-button--variants", prepare: async page => {
    await expect(page.getByRole("button", { name: "primary", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "不可用", exact: true })).toBeDisabled();
  } },
  { name: "button-loading", id: "primitives-button--loading", prepare: async page => {
    const button = page.getByRole("button", { name: "保存中…", exact: true });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAttribute("data-loading", "true");
    await expect(button.locator('[aria-hidden="true"]')).toBeVisible();
  } },
  { name: "checkbox", id: "primitives-checkbox--keyboard", prepare: async page => {
    await expect(page.getByRole("checkbox", { name: "显示内容", exact: true })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "不可用", exact: true })).toBeChecked();
  } },
  { name: "color-picker", id: "primitives-colorpicker--keyboard-commit", prepare: async page => {
    await expect(page.getByRole("group", { name: "颜色选择器", exact: true })).toBeVisible();
    await expect(page.getByRole("slider", { name: "色相", exact: true })).toBeVisible();
  } },
  { name: "dialog", id: "primitives-dialog--composed-popup", prepare: async page => {
    await page.getByRole("button", { name: "打开组合浮层", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "组合浮层", exact: true })).toBeVisible();
    await expect(page.locator('output[aria-label="浮层状态"]')).toHaveText("已打开");
  } },
  { name: "dropdown-menu", id: "primitives-dropdownmenu--open-states", prepare: async page => {
    await expect(page.getByRole("menu", { name: "菜单状态", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "普通动作", exact: true })).toBeVisible();
  } },
  { name: "icons", id: "primitives-icons--catalog", prepare: async page => {
    await expect(page.getByRole("list", { name: "界面图标", exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").first()).toBeVisible();
  } },
  { name: "input", id: "primitives-input--states", prepare: async page => {
    await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("我的名称");
    await expect(page.getByRole("textbox", { name: "错误", exact: true })).toHaveAttribute("aria-invalid", "true");
  } },
  { name: "popover", id: "primitives-popover--focus-and-dismissal", prepare: async page => {
    await page.getByRole("button", { name: "编辑名称", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "名称设置", exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("我的空间");
  } },
  { name: "portal", id: "primitives-portal--toolbar-isolation", prepare: async page => {
    await expect(page.getByRole("toolbar", { name: "源工具栏", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "浮层保存", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "浮层取消", exact: true })).toBeVisible();
  } },
  { name: "radio-group", id: "primitives-radiogroup--keyboard", prepare: async page => {
    await expect(page.getByRole("radiogroup", { name: "外观", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "白天", exact: true })).toBeChecked();
  } },
  { name: "select", id: "primitives-select--description-and-density", prepare: async page => {
    await page.getByRole("combobox", { name: "form", exact: true }).click();
    await expect(page.getByRole("option", { name: "零", exact: true })).toBeVisible();
  } },
  { name: "sheet", id: "primitives-sheet--focus", prepare: async page => {
    await page.getByRole("button", { name: "查看评论", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "评论", exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.getByText("查看和恢复已保存的正文。", { exact: true })).toBeVisible();
  } },
  { name: "skeleton", id: "primitives-skeleton--default", prepare: async page => {
    await expect(page.locator('[data-slot="ob-skeleton"]')).toHaveCount(3);
    await expect(page.locator('[data-slot="ob-skeleton"]').first()).toBeVisible();
  } },
  { name: "spinner", id: "primitives-spinner--default", prepare: async page => {
    await expect(page.getByRole("status", { name: "加载中", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "正在读取", exact: true })).toBeVisible();
  } },
  { name: "tabs", id: "primitives-tabs--keyboard", prepare: async page => {
    await expect(page.getByRole("tablist", { name: "内容", exact: true })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "内容一", exact: true })).toHaveText("第一部分");
  } },
  { name: "textarea", id: "primitives-textarea--states", prepare: async page => {
    await expect(page.getByRole("textbox", { name: "个人简介", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "只读简介", exact: true })).toHaveValue("现有简介");
    await expect(page.getByRole("textbox", { name: "不可用", exact: true })).toBeDisabled();
  } },
  { name: "toast", id: "primitives-toast--dismissal", prepare: async page => {
    await page.getByRole("button", { name: "显示通知", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "保存失败", exact: true });
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAccessibleDescription("服务暂不可用，请重试");
  } },
  { name: "toggle", id: "primitives-toggle--keyboard", prepare: async page => {
    await expect(page.getByRole("button", { name: "粗体", exact: true })).toHaveAttribute("aria-pressed", "true");
  } },
  { name: "toolbar", id: "primitives-toolbar--navigation", prepare: async page => {
    const toolbar = page.getByRole("toolbar", { name: "格式", exact: true });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("combobox", { name: "段落", exact: true })).toContainText("标题");
  } },
  { name: "tooltip", id: "primitives-tooltip--link-semantics", prepare: async page => {
    await page.getByRole("link", { name: "使用指南", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("打开使用指南");
  } },
];

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test.describe(`Storybook ${theme} ${width}px`, () => {
    test.use({ reducedMotion: "reduce", viewport: { width, height: 900 } });

    for (const story of stories) test(story.name, async ({ page }) => {
      const query = new URLSearchParams({ id: story.id, viewMode: "story", globals: `theme:${theme}` });
      await page.goto(`${STORYBOOK_ORIGIN}/iframe.html?${query}`);
      await waitForStoryReady(page, story.id);
      await expect(page.locator("#storybook-root > [data-theme]")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await story.prepare(page);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).filter(image => image.getClientRects().length > 0).map(image => image.decode()));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await expect(page).toHaveScreenshot(`${story.name}-${theme}-${width}.png`);
    });
  });
}
