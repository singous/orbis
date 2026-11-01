import { controlFeedbackClassName } from "../../../shared/ui/control-styles";

export const readerFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ob-reader-accent)";
export const readerTouchTarget = "pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)";
export const readerIconButton = `size-[31px] shrink-0 cursor-pointer place-items-center rounded-ob-xl border-0 border-current bg-transparent p-0 text-(--ob-reader-muted) hover:bg-(--ob-reader-surface-soft) hover:text-(--ob-reader-text) ${controlFeedbackClassName} ${readerFocus} ${readerTouchTarget}`;
