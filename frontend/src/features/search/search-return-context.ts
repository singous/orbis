const SEARCH_TRIGGER_SELECTOR = 'button[aria-haspopup="dialog"]:is([aria-label="搜索"], [aria-label="全局搜索"])';
const MAIN_NAVIGATION_TRIGGER_SELECTOR = 'button[aria-label="打开主导航"]';

function availableFocusTarget(element: HTMLElement): boolean {
  if (element.matches(':disabled, [aria-disabled="true"]') || element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** A palette must return to the original caret and viewport, including offscreen carets. */
export function captureSearchReturnContext(): () => void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const searchTriggerName = focused?.matches(SEARCH_TRIGGER_SELECTOR) ? focused.getAttribute("aria-label") : null;
  const fromNavigationDrawer = Boolean(searchTriggerName && focused?.closest(".workspace-shell.main-navigation-open .workspace-main-navigation"));
  const selection = window.getSelection();
  const range = focused && selection?.rangeCount && focused.contains(selection.anchorNode) && focused.contains(selection.focusNode)
    ? selection.getRangeAt(0).cloneRange()
    : null;
  const backward = Boolean(range && selection?.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset);
  const scrollPositions: Array<{ element: HTMLElement; top: number; left: number }> = [];
  for (let element = focused; element; element = element.parentElement) {
    scrollPositions.push({ element, top: element.scrollTop, left: element.scrollLeft });
  }
  const viewport = { top: window.scrollY, left: window.scrollX };

  return () => {
    let target = focused?.isConnected ? focused : null;
    if (!target && searchTriggerName) {
      // 懒加载替换了临时框架时，只恢复同名搜索入口；编辑器选区仍要求原节点存活。
      target = Array.from(document.querySelectorAll<HTMLElement>(SEARCH_TRIGGER_SELECTOR))
        .find(element => element.getAttribute("aria-label") === searchTriggerName && availableFocusTarget(element)) ?? null;
      if (!target && fromNavigationDrawer) {
        target = Array.from(document.querySelectorAll<HTMLElement>(MAIN_NAVIGATION_TRIGGER_SELECTOR)).find(availableFocusTarget) ?? null;
      }
    }
    if (!target) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== target && active.isConnected) return;
    target.focus({ preventScroll: true });
    if (target !== focused) return;
    if (range?.startContainer.isConnected && range.endContainer.isConnected) {
      const current = window.getSelection();
      if (backward) current?.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
      else current?.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    }
    for (const position of scrollPositions) {
      if (!position.element.isConnected) continue;
      position.element.scrollTop = position.top;
      position.element.scrollLeft = position.left;
    }
    if (window.scrollX !== viewport.left || window.scrollY !== viewport.top) window.scrollTo(viewport);
  };
}
