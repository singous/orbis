/** Shared Orbis workbench geometry; uncommon dimensions preserve the existing layouts. */
export const workbenchStyles = {
  section: "workbench-section mb-[38px] max-[560px]:mb-[30px]",
  sectionHeading: "workbench-section-heading mb-[17px] flex min-h-7 items-center justify-between gap-[18px] max-[560px]:gap-3",
  sectionTitle: "m-0 text-base font-semibold leading-6 tracking-[-.015em] text-ob-foreground",
  sectionCount: "text-xs leading-[18px] text-ob-muted-foreground",
  more: "workbench-more inline-flex items-center gap-[5px] whitespace-nowrap text-xs font-normal leading-[18px] text-ob-muted-foreground hover:text-ob-foreground",
  resourceGrid: "workbench-resource-grid grid grid-cols-2 gap-x-4 gap-y-[13px] max-[850px]:grid-cols-1",
  resourceCard: "workbench-resource-card flex min-h-[84px] min-w-0 items-center gap-[17px] rounded-[15px] border border-ob-surface-edge bg-ob-card px-5 py-[17px] shadow-ob-card transition-[border-color,background-color,box-shadow] duration-(--ob-motion-feedback) hover:border-ob-border hover:shadow-ob-card-hover motion-reduce:transition-none max-[560px]:gap-3 max-[560px]:p-4",
  resourceIcon: "workbench-resource-icon grid size-10 shrink-0 place-items-center rounded-ob-xl text-(--ob-page-muted-foreground)",
  resourceCopy: "workbench-resource-copy flex min-w-0 flex-1 flex-col gap-[5px]",
  resourceTitle: "m-0 truncate text-sm font-medium leading-5 text-ob-foreground",
  resourceCaption: "block truncate text-sm leading-5 text-(--ob-page-muted-foreground)",
  resourceChevron: "workbench-resource-chevron shrink-0 text-(--ob-page-muted-foreground)",
  documentList: "workbench-document-list m-0 list-none overflow-hidden p-0",
  documentRow: "workbench-document-row flex min-h-[78px] min-w-0 items-center gap-[18px] border-b border-ob-workspace-divider px-[9px] py-[15px] text-(--ob-page-muted-foreground) transition-colors duration-(--ob-motion-feedback) motion-reduce:transition-none max-[560px]:gap-3",
  listIcon: "workbench-list-icon grid w-6 shrink-0 place-items-center text-(--ob-page-muted-foreground)",
  listTime: "shrink-0 whitespace-nowrap text-xs leading-[18px] text-(--ob-page-muted-foreground)",
  emptySection: "workbench-empty-section flex min-h-[170px] flex-col items-start justify-center gap-2.5 py-7 text-(--ob-page-muted-foreground)",
  emptyTitle: "m-0 text-base font-medium leading-6 text-ob-foreground",
  emptyDescription: "mb-[5px] text-sm leading-5 text-ob-muted-foreground",
  back: "workbench-back mb-6 inline-flex items-center gap-1.5 text-sm leading-5 text-ob-muted-foreground hover:text-ob-foreground",
};

export const profileStyles = {
  section: "workbench-settings-section max-w-[800px]",
  form: "profile-edit-form grid max-w-[520px] gap-6",
  field: "profile-field grid gap-1.5 text-sm font-medium leading-5",
  actions: "profile-form-actions flex justify-end",
  settingsList: "workbench-settings-list m-0 [&>div]:grid [&>div]:grid-cols-[180px_minmax(0,1fr)] [&>div]:items-center [&>div]:gap-6 [&>div]:border-b [&>div]:border-ob-workspace-divider [&>div]:py-[23px] [&>div]:text-sm [&>div]:leading-5 [&_dt]:text-ob-muted-foreground [&_dd]:m-0 [&_dd]:wrap-anywhere max-[560px]:[&>div]:grid-cols-[90px_minmax(0,1fr)] max-[560px]:[&>div]:gap-[18px]",
};
