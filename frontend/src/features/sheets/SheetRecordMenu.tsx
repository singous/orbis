import { cn } from "@orbis/ui/cn";
import { sheetMenuClassName, sheetMenuActionClassName } from "./sheet-chrome";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Expand, Trash2 } from "@orbis/ui/icons";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { MAX_BATCH } from "./model";
import { Popover, type Anchor } from "./Popover";

type Props = { anchor: Anchor; multiple: boolean; readOnly: boolean; busy: boolean; manualOrder: boolean;
  onClose: () => void; onCopy: () => void; onPaste: () => void; onInsert: (before: boolean, count: number) => void;
  onDuplicate: () => void; onInspect: () => void; onDelete: () => void };
export function SheetRecordMenu({ anchor, multiple, readOnly, busy, manualOrder, onClose, onCopy, onPaste, onInsert, onDuplicate, onInspect, onDelete }: Props) {
  const [above, setAbove] = useState("1");
  const [below, setBelow] = useState("1");
  const valid = (value: string) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= MAX_BATCH;
  const run = (action: () => void) => { onClose(); action(); };
  return <Popover anchor={anchor} label="记录操作" onClose={onClose} className="w-[278px] p-2.5">
    <div className={sheetMenuClassName} role="menu" aria-label={multiple ? "多选记录操作" : "记录操作"}>
      <Button className={sheetMenuActionClassName} role="menuitem" disabled={busy} onClick={() => run(onCopy)} variant="ghost">复制<kbd>Ctrl+C</kbd></Button>
      <Button className={sheetMenuActionClassName} role="menuitem" disabled={readOnly || busy} onClick={() => run(onPaste)} variant="ghost">粘贴<kbd>Ctrl+V</kbd></Button>
      <hr />
      {!multiple && <>
        {([{ before: true, value: above, set: setAbove }, { before: false, value: below, set: setBelow }]).map(item => <div key={String(item.before)} className="flex items-center gap-1 pr-2 [&>button]:flex-1">
          <Button className={sheetMenuActionClassName} role="menuitem" disabled={readOnly || busy || !manualOrder || !valid(item.value)} title={!manualOrder ? "请先关闭排序、筛选和分组后调整记录顺序" : undefined} onClick={() => run(() => onInsert(item.before, Number(item.value)))} variant="ghost">{item.before ? <ArrowUp size={16} /> : <ArrowDown size={16} />}{item.before ? "向上插入" : "向下插入"}</Button>
          <Input className="w-14 min-w-0 text-center" type="number" aria-label={item.before ? "向上插入行数" : "向下插入行数"} min={1} max={MAX_BATCH} value={item.value} disabled={readOnly || busy || !manualOrder} onChange={event => item.set(event.target.value)} /><span>行</span>
        </div>)}
        <hr />
        <Button className={sheetMenuActionClassName} role="menuitem" disabled={readOnly || busy} onClick={() => run(onDuplicate)} variant="ghost"><Copy size={16} />复制行</Button>
        <Button className={sheetMenuActionClassName} role="menuitem" onClick={() => run(onInspect)} variant="ghost"><Expand size={16} />展开行<kbd>Space</kbd></Button>
      </>}
      <Button className={cn(sheetMenuActionClassName, "text-(--destructive)")} role="menuitem" disabled={readOnly || busy} onClick={() => run(onDelete)} variant="ghost"><Trash2 size={16} />删除行</Button>
    </div>
  </Popover>;
}
