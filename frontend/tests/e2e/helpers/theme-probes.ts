import { expect, type Locator } from "@playwright/test";

export async function expectTokenStyles(element: Locator, properties: Record<string, string>) {
  const resolved = await element.evaluate((element, properties) => {
    const source = getComputedStyle(element);
    const values = Object.entries(properties).map(([property, token]) => {
      const value = source.getPropertyValue(token).trim();
      const probe = document.createElement("span");
      // 全局 reduced-motion 仍使用 0.01ms；参考元素不能采到这段过渡的起始值。
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;transition:none!important;animation:none!important";
      probe.style.setProperty(property, value);
      element.parentElement!.append(probe);
      const expected = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return { property, token, value, valid: CSS.supports(property, value), expected };
    });
    return values;
  }, properties);
  for (const { property, token, value, valid, expected } of resolved) {
    expect(value, `${token} must exist on the rendered control`).not.toBe("");
    expect(valid, `${token} must be valid for ${property}`).toBe(true);
    expect(expected, `${token} must resolve to a computed ${property}`).not.toBe("");
    await expect.poll(() => element.evaluate((element, { property, expected }) => {
      const actual = getComputedStyle(element).getPropertyValue(property);
      if (!property.endsWith("color")) return actual === expected || `${actual} != ${expected}`;
      // CSS transitions can serialize the same painted color as oklab or oklch.
      const context = document.createElement("canvas").getContext("2d")!;
      const channels = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).join(",");
      };
      return actual !== "" && channels(actual) === channels(expected) || `${actual} (${channels(actual)}) != ${expected} (${channels(expected)})`;
    }, { property, expected }), { message: `${property} follows ${token}` }).toBe(true);
  }
}
