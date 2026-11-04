import { expect, type Locator } from "@playwright/test";
import { readContrasts } from "./contrast";

const MAX_REDUCED_MOTION_MS = 1;
const MAX_FOCUS_COLOR_TRANSITION_MS = 200;

// 普通模式检查实际绘制的原生焦点边框或轮廓；系统高对比模式使用共享轮廓。
export async function expectVisibleKeyboardFocus(target: Locator, indicator: Locator = target) {
  await expect(target).toBeFocused();
  await expect(indicator).toBeInViewport();
  // Base UI 在首帧撤掉 starting 样式；跨过实际绘制帧再测量最终可见颜色。
  await indicator.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await indicator.evaluate(async (element, maximum) => {
    const colorTransitions = element.getAnimations().filter(animation => animation instanceof CSSTransition && /color$/.test(animation.transitionProperty) && Number(animation.effect?.getComputedTiming().endTime) <= maximum);
    await Promise.all(colorTransitions.map(animation => animation.finished));
  }, MAX_FOCUS_COLOR_TRANSITION_MS);
  await expect(target).toBeFocused();
  const metrics = await indicator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      unobscured: hit !== null && element.contains(hit),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      focusVisible: element.matches(":focus-visible"),
      highlightedItem: element.matches('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]'),
      background: style.backgroundColor,
      borderStyle: style.borderTopStyle,
      borderWidth: Number.parseFloat(style.borderTopWidth),
      borderColor: style.borderTopColor,
    };
  });
  expect(metrics.unobscured).toBe(true);
  const transparent = (color: string) => /^transparent$|^rgba\([^)]*,\s*0\)$/.test(color);
  const outline = metrics.outlineStyle !== "none" && metrics.outlineWidth > 0 && !transparent(metrics.outlineColor);
  if (!outline && metrics.highlightedItem) {
    expect(metrics.focusVisible).toBe(true);
    expect(transparent(metrics.background)).toBe(false);
    const [contrast] = await readContrasts(indicator, [null]);
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
    return { ...metrics, indicator: "background", contrast };
  }
  if (!outline) {
    expect(metrics.focusVisible).toBe(true);
    expect(metrics.borderStyle).not.toBe("none");
    expect(metrics.borderWidth).toBeGreaterThan(0);
  }
  const [contrast] = await readContrasts(indicator, [null], outline ? "outlineColor" : "borderTopColor");
  expect(contrast.ratio).toBeGreaterThanOrEqual(3);
  return { ...metrics, indicator: outline ? "outline" : "border", contrast };
}

export async function expectNoContinuingMotion(target: Locator) {
  const frames = await target.evaluate(async element => {
    await document.fonts.ready;
    const sample = () => {
      const box = element.getBoundingClientRect();
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        activeAnimations: element.getAnimations({ subtree: true }).filter(animation => animation.pending || animation.playState === "running").map(animation => ({ playState: animation.playState, timing: animation.effect?.getComputedTiming() })),
      };
    };
    // 观察实际渲染帧，捕获 reduce 模式下仍在持续的过渡，而不改写计时器。
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const first = sample();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return [first, sample()];
  });
  for (const frame of frames) for (const animation of frame.activeAnimations) {
    // 现有 reduce 契约允许单次 0.01ms 过渡保留结束事件；不允许长延迟或持续迭代。
    expect(animation.timing?.iterations).toBeLessThanOrEqual(1);
    expect(animation.timing?.activeDuration).toBeLessThanOrEqual(MAX_REDUCED_MOTION_MS);
    expect(animation.timing?.endTime).toBeLessThanOrEqual(MAX_REDUCED_MOTION_MS);
  }
  expect(frames[1].box).toEqual(frames[0].box);
  return frames;
}
