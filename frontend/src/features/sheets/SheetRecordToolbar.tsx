import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { AlignVerticalSpaceAround, ArrowDown, FileInput, Filter, Group, Plus, Search, Settings2 } from "@orbis/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@orbis/ui/tooltip";
import { releaseFeatures } from "../../shared/release-features";
import { sheetActionClassName } from "./sheet-chrome";
import type { View } from "./model";
import type { SettingsMode } from "./ViewSettings";

const settings = [
  { mode: "columns", Icon: Settings2, label: "字段管理" },
  { mode: "filter", Icon: Filter, label: "筛选" },
  { mode: "group", Icon: Group, label: "分组" },
  { mode: "sort", Icon: ArrowDown, label: "排序" },
  { mode: "height", Icon: AlignVerticalSpaceAround, label: "行高" },
] as const;

type Props = {
  embedded?: boolean;
  canEdit: boolean;
  busy?: boolean;
  view?: View;
  search?: string;
  onSettings?: (mode: SettingsMode, target: HTMLButtonElement) => void;
  onSearch?: (value: string) => void;
  onAdd?: () => void;
  onCreateForm?: () => void;
};

export function SheetRecordToolbar({ embedded, canEdit, busy, view, search = "", onSettings, onSearch, onAdd, onCreateForm }: Props) {
  const actionClassName = cn(sheetActionClassName, embedded && "min-w-[30px] px-[7px]");
  const appliedSettings = { filter: view?.filters.length, sort: view?.sorts.length, group: view?.group_field_id, columns: false, height: false };
  const labelClassName = cn("sheet-tool-label", embedded && "hidden in-[.embed-surface.is-expanded]:inline");
  return (
    <div className={cn("sheet-toolbar flex shrink-0 items-center gap-1 border-b border-b-(--ob-sheet-chrome-border) bg-(--ob-sheet-toolbar-bg) py-1.5 whitespace-nowrap overscroll-x-contain", embedded ? "min-h-10 flex-wrap overflow-visible px-2.5" : "min-h-11 overflow-x-auto px-5 [@media(max-width:760px)]:px-3")}>
      {settings.map(({ mode, Icon, label }) => (
        <Tooltip key={mode}>
          <TooltipTrigger render={<Button size="sm" aria-label={label} disabled={!onSettings || !canEdit || busy}
            className={cn(actionClassName, appliedSettings[mode] && "is-set bg-(--accent) text-primary forced-colors:bg-primary forced-colors:text-primary-foreground forced-colors:[forced-color-adjust:none]")}
            onClick={event => onSettings?.(mode, event.currentTarget)} variant="ghost">
            <Icon size={14} /><span className={labelClassName}>{label}</span>
          </Button>} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
      <label className={cn("flex max-w-[190px] items-center gap-[7px] rounded-lg border border-(--ob-sheet-chrome-border) px-[9px] py-[5px] text-(--muted-foreground) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring pointer-coarse:min-h-(--ob-control-height-touch)", embedded ? "min-w-20 flex-1" : "ml-2 min-w-[110px] shrink-0")}>
        <Search size={14} />
        <input className="w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none" aria-label="搜索记录" placeholder="搜索" value={search} disabled={!onSearch}
          onChange={event => onSearch?.(event.target.value)} />
      </label>
      {canEdit ? <Button className={actionClassName} size="sm" disabled={!onAdd || busy} onClick={onAdd} variant="ghost"><Plus size={14} />添加记录</Button> : null}
      <span className="sheet-toolbar-spacer flex-1" />
      {canEdit && releaseFeatures.sheetForms ? <Button className={actionClassName} size="sm" aria-label="生成表单" title="生成表单" disabled={!onCreateForm} onClick={onCreateForm} variant="ghost">
        <FileInput size={14} /><span className="sheet-tool-label">生成表单</span>
      </Button> : null}
    </div>
  );
}
