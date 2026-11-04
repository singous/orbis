import { expect, type Locator, type Page } from "@playwright/test";

export async function expectUnpaintedBoxShadow(element: Locator) {
  const shadow = await element.evaluate(element => {
    const value = getComputedStyle(element).boxShadow;
    const colors = value.match(/\b(?:rgba?|hsla?|(?:ok)?lab|(?:ok)?lch|color)\([^)]*\)/g) ?? [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const alphas = colors.map(color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    return { value, alphas };
  });
  expect(shadow.value === "none" || shadow.alphas.length > 0, `Expected a parsed shadow: ${shadow.value}`).toBe(true);
  expect(shadow.alphas.every(alpha => alpha === 0), `Expected every shadow layer to be unpainted: ${shadow.value}`).toBe(true);
}

export async function sampleSidebarToggle(page: Page, label: string) {
  return page.evaluate(async name => {
    await document.fonts.ready;
    const grid = document.querySelector(".workspace-shell-grid")!;
    const navigation = document.querySelector(".workspace-main-navigation")!;
    const shell = navigation.closest(".workspace-shell")!;
    const button = Array.from(navigation.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === name)!;
    const rail = navigation.querySelector(".workspace-business-nav")!;
    const railWidth = navigation.querySelector(".workspace-business-rail")!.getBoundingClientRect().width;
    const startRailTop = rail.getBoundingClientRect().top;
    const startWidth = navigation.getBoundingClientRect().width;
    const widths: number[] = [];
    const railTops: number[] = [];
    const wasCollapsed = shell.classList.contains("sidebar-collapsed");
    button.click();
    do {
      await new Promise(requestAnimationFrame);
    } while (shell.classList.contains("sidebar-collapsed") === wasCollapsed);
    const animations = grid.getAnimations({ subtree: true }).filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
    const transitions = animations.map(animation => `${animation.transitionProperty}:${animation.effect?.getTiming().duration}`);
    let sampling = true;
    // 起点提交和 CSS 过渡启动可能晚于 click；终点必须等真实动画完成，不能按固定墙钟采样。
    await Promise.all([
      Promise.all(animations.map(animation => animation.finished)).finally(() => { sampling = false; }),
      (async () => {
        do {
          await new Promise(requestAnimationFrame);
          widths.push(navigation.getBoundingClientRect().width);
          railTops.push(rail.getBoundingClientRect().top);
        } while (sampling);
      })(),
    ]);
    const endWidth = navigation.getBoundingClientRect().width;
    const endRailTop = rail.getBoundingClientRect().top;
    const railLow = Math.min(startRailTop, endRailTop) + 1;
    const railHigh = Math.max(startRailTop, endRailTop) - 1;
    const low = Math.min(startWidth, endWidth) + 1;
    const high = Math.max(startWidth, endWidth) - 1;
    return { startWidth, endWidth, railWidth, startRailTop, endRailTop, railIntermediateFrames: railTops.filter(top => top > railLow && top < railHigh).length, intermediateFrames: widths.filter(width => width > low && width < high).length, transitions };
  }, label);
}
