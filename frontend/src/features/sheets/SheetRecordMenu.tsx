import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Expand, Trash2 } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
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
  return <Popover anchor={anchor} label="记录操作" onClose={onClose} className="sheet-record-menu">
    <div className="sheet-menu" role="menu" aria-label={multiple ? "多选记录操作" : "记录操作"}>
      <ActionButton role="menuitem" disabled={busy} onClick={() => run(onCopy)}>复制<kbd>Ctrl+C</kbd></ActionButton>
      <ActionButton role="menuitem" disabled={readOnly || busy} onClick={() => run(onPaste)}>粘贴<kbd>Ctrl+V</kbd></ActionButton>
      <hr />
      {!multiple && <>
        {([{ before: true, value: above, set: setAbove }, { before: false, value: below, set: setBelow }]).map(item => <div key={String(item.before)} className="sheet-insert-row">
          <ActionButton role="menuitem" disabled={readOnly || busy || !manualOrder || !valid(item.value)} title={!manualOrder ? "请先关闭排序、筛选和分组后调整记录顺序" : undefined} onClick={() => run(() => onInsert(item.before, Number(item.value)))}>{item.before ? <ArrowUp size={16} /> : <ArrowDown size={16} />}{item.before ? "向上插入" : "向下插入"}</ActionButton>
          <input type="number" aria-label={item.before ? "向上插入行数" : "向下插入行数"} min={1} max={MAX_BATCH} value={item.value} disabled={readOnly || busy || !manualOrder} onChange={event => item.set(event.target.value)} /><span>行</span>
        </div>)}
        <hr />
        <ActionButton role="menuitem" disabled={readOnly || busy} onClick={() => run(onDuplicate)}><Copy size={16} />复制行</ActionButton>
        <ActionButton role="menuitem" onClick={() => run(onInspect)}><Expand size={16} />展开行<kbd>Space</kbd></ActionButton>
      </>}
      <ActionButton role="menuitem" className="sheet-danger-action" disabled={readOnly || busy} onClick={() => run(onDelete)}><Trash2 size={16} />删除行</ActionButton>
    </div>
  </Popover>;
}
