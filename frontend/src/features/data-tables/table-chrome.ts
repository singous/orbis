/** 数据表外壳在编辑块、加载态与公开快照之间共用；网格尺寸仍由各自内核负责。 */
export const tableSurfaceClassName = "data-table relative my-5 min-w-0 overflow-visible rounded-[10px] border border-border bg-card [font-family:inherit] text-[13px] leading-[1.45] text-foreground [&_button]:[font:inherit] [.embed-content>&]:m-0 [.embed-content>&]:flex [.embed-content>&]:h-full [.embed-content>&]:flex-col [.embed-content>&]:rounded-none [.embed-content>&]:border-0";
export const tableHeadingClassName = "dt-heading flex items-center gap-2.5 border-b border-border px-4 py-3.5 [.embed-content>.data-table>&]:pr-12";
export const tableFooterClassName = "flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-[12px] text-(--muted-foreground) [&>div]:flex [&>div]:items-center [&>div]:gap-2 [@media(max-width:720px)]:flex-wrap";
export const tableEmptyClassName = "px-5 py-[42px] text-center text-[13px] text-(--muted-foreground)";
export const tableStartClassName = `${tableSurfaceClassName} flex flex-wrap items-center gap-4 p-6 [&_p]:mt-1 [&_p]:text-[12px] [&_p]:text-(--muted-foreground) [&>button]:ml-auto`;
export const tableFormClassName = "flex max-h-[70vh] flex-col gap-4 overflow-auto p-0.5 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded-lg [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_legend]:px-1.5 [&_legend]:text-sm [&_legend]:text-muted-foreground";
export const tableFormActionsClassName = "flex justify-end gap-2 pt-2.5";
export const tableSettingRowClassName = "flex items-center gap-2 [&_label]:flex-1 [&_input[type=number]]:w-[72px]";
export const tableFilterRowClassName = "flex flex-wrap items-center gap-2 [&_input]:min-w-0 [&_input]:flex-1 [&>[data-slot=select-trigger]]:min-w-[100px] [&>[data-slot=select-trigger]]:flex-1";
