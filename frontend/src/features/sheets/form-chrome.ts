/** 编辑与公开填写共用表单内容布局。 */
const formPaperClassName = "sheet-form-paper w-full min-w-0 max-w-[720px] rounded-[12px] border border-border bg-card text-foreground [box-shadow:var(--shadow-sm)] [overflow-wrap:anywhere]";
export const editorFormPaperClassName = `${formPaperClassName} mx-auto mb-6 p-8 [@media(max-width:1000px)]:p-6 [@media(max-width:760px)]:m-0`;
export const publicFormPaperClassName = `${formPaperClassName} mx-auto my-0 p-10 [@media(max-width:760px)]:p-6`;
export const formQuestionClassName = "sheet-form-question group/form-question mb-6 flex flex-col gap-3 border-t border-border pt-6 [&>label]:font-medium [&>label]:leading-5 [&>div>label]:font-medium! [&>div>label]:leading-5";
export const formRequiredClassName = "mr-1.5 text-(--destructive) not-italic";
export const editorFormDescriptionClassName = "sheet-form-description my-3 mb-6 min-h-12 w-full";
export const publicFormDescriptionClassName = "sheet-form-description my-3 block min-h-12 w-full bg-transparent p-0 [font:inherit] text-(--muted-foreground) mb-7";
export const publicFormClassName = "sheet-public sheet-data-theme min-h-dvh bg-background px-5 py-12 text-sm leading-5 text-foreground [@media(max-width:760px)]:px-3 [@media(max-width:760px)]:py-5 [@media(max-width:760px)]:[&_[data-slot=input]]:min-h-(--ob-control-height-touch) [@media(max-width:760px)]:[&_.sheet-radio-options_label]:min-h-(--ob-control-height-touch) [@media(max-width:760px)]:[&_.sheet-multi-options_label]:min-h-(--ob-control-height-touch) pointer-coarse:[&_input:not([type=checkbox],[type=radio],[type=range],.sheet-form-title)]:text-[16px] pointer-coarse:[&_textarea]:text-[16px]";
export const publicFormTitleClassName = "m-0 text-2xl font-semibold";
