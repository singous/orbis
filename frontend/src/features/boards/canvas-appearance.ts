export type BoardCanvasChrome = {
  imagePlaceholder: string;
  imageError: string;
  selection: string;
};

export function boardCanvasChrome(style: CSSStyleDeclaration): BoardCanvasChrome {
  return {
    imagePlaceholder: style.getPropertyValue("--ob-board-image-placeholder").trim(),
    imageError: style.getPropertyValue("--ob-board-image-error").trim(),
    selection: style.getPropertyValue("--ob-board-renderer-selection").trim(),
  };
}

/** 画布与素材预览无法继承 CSS 绘制颜色，由各自 DOM 根同步已解析的主题角色。 */
export function observeBoardAppearance(element: HTMLElement, sync: (style: CSSStyleDeclaration) => void) {
  const observer = new MutationObserver(() => sync(getComputedStyle(element)));
  for (let scope: HTMLElement | null = element; scope; scope = scope.parentElement) {
    observer.observe(scope, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  }
  return () => observer.disconnect();
}
