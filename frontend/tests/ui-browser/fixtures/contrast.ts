import type { Locator } from "@playwright/test";

export function readContrasts(root: Locator, selectors: Array<string | null>, foregroundProperty: "color" | "outlineColor" | "borderTopColor" = "color") {
  return root.evaluate((element, { selectors, foregroundProperty }) => {
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
    const over = (front: number[], back: number[]) => {
      const frontAlpha = front[3] / 255, backAlpha = back[3] / 255;
      const alpha = frontAlpha + backAlpha * (1 - frontAlpha);
      return alpha === 0 ? [0, 0, 0, 0] : [
        ...front.slice(0, 3).map((channel, index) => (channel * frontAlpha + back[index] * backAlpha * (1 - frontAlpha)) / alpha),
        alpha * 255,
      ];
    };
    return selectors.map(selector => {
      const node = selector === null ? element : element.querySelector<HTMLElement>(selector)!;
      const style = getComputedStyle(node), color = style[foregroundProperty];
      const outside = foregroundProperty === "outlineColor" && Number.parseFloat(style.outlineOffset) >= 0;
      let surface = outside ? [0, 0, 0, 0] : rgba(style.backgroundColor);
      let ink = over(rgba(color), surface);
      ink[3] *= Number(style.opacity);
      surface[3] *= Number(style.opacity);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const ancestor = getComputedStyle(parent), background = rgba(ancestor.backgroundColor);
        ink = over(ink, background);
        surface = over(surface, background);
        ink[3] *= Number(ancestor.opacity);
        surface[3] *= Number(ancestor.opacity);
      }
      if (surface[3] < 255) throw new Error(`No opaque fixture background for ${selector}`);
      const foregroundY = luminance(ink), backgroundY = luminance(surface);
      return { selector, color, background: `rgb(${surface.slice(0, 3).join(", ")})`, renderedForeground: ink, renderedBackground: surface, ratio: (Math.max(foregroundY, backgroundY) + .05) / (Math.min(foregroundY, backgroundY) + .05) };
    });
  }, { selectors, foregroundProperty });
}
