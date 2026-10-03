/** A palette must return to the original caret and viewport, including offscreen carets. */
export function captureSearchReturnContext(): () => void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    if (!focused?.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== focused && active.isConnected) return;
    focused.focus({ preventScroll: true });
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
