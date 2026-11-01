import type { Locator } from "@playwright/test";

export function readContrasts(root: Locator, selectors: string[]) {
  return root.evaluate((element, selectors) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (channels: number[]) => {
      const linear = channels.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    return selectors.map(selector => {
      const node = element.querySelector<HTMLElement>(selector)!;
      let parent: HTMLElement | null = node;
      while (parent && rgba(getComputedStyle(parent).backgroundColor)[3] !== 255) parent = parent.parentElement;
      if (!parent) throw new Error(`No opaque fixture background for ${selector}`);
      const color = getComputedStyle(node).color, background = getComputedStyle(parent).backgroundColor;
      const foregroundY = luminance(rgba(color)), backgroundY = luminance(rgba(background));
      return { selector, color, background, ratio: (Math.max(foregroundY, backgroundY) + .05) / (Math.min(foregroundY, backgroundY) + .05) };
    });
  }, selectors);
}
