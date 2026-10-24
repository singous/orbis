import { DEFAULT_STYLE, SHAPES, type Element } from "./model";
import { isMindmapBranch } from "./geometry";

export const DEFAULT_BOARD_BACKGROUND = "#f2f4f7";

/** 默认工作底色跟随应用主题；自定义页面颜色仍按作者保存的值展示。 */
export function boardCanvasBackground(background: string) {
  return background.toLowerCase() === DEFAULT_BOARD_BACKGROUND ? "var(--board-canvas)" : background;
}

export function boardCanvasTextColor(background: string) {
  return background.toLowerCase() === DEFAULT_BOARD_BACKGROUND ? "var(--text-primary)" : DEFAULT_STYLE.text_color;
}

/** 只调整直接落在画布上的默认文字；实色图形和作者自定义的文字颜色保持原样。 */
export function boardElementStyle(element: Element, canvasTextColor: string) {
  const style = isMindmapBranch(element) && element.style.fill.toLowerCase() === DEFAULT_STYLE.fill
    ? { ...element.style, fill: "transparent" } : element.style;
  const primitive = SHAPES.get(element.shape_type)?.primitive;
  const onCanvas = element.shape_type === "connector" || style.fill === "transparent" ||
    ["text", "actor", "annotation", "line", "search"].includes(primitive ?? "");
  return onCanvas && style.text_color.toLowerCase() === DEFAULT_STYLE.text_color
    ? { ...style, text_color: canvasTextColor }
    : style;
}
