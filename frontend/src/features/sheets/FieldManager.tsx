import { Spinner } from "@orbis/ui/spinner";
import { cn } from "@orbis/ui/cn";
import { sheetActionClassName, sheetMenuClassName, sheetMenuActionClassName } from "./sheet-chrome";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal, Pencil, Trash2 } from "@orbis/ui/icons";
import { reportError } from "../../shared/api/request-feedback";
import { Button } from "@orbis/ui/button";

import { FieldIcon } from "./FieldIcon";
import { Popover, anchorAt, type Anchor } from "./Popover";
import type { Field, View } from "./model";
import { usePointerReorder } from "./use-pointer-reorder";

type Props = { fields: Field[]; view: View; anchor: Anchor; onSave: (view: View) => Promise<unknown>; onClose: () => void;
  onFieldAction?: (action: string, field: Field, anchor: Anchor) => void };

export function FieldManager({ fields, view, anchor, onSave, onClose, onFieldAction }: Props) {
  const latestAction = useRef(onFieldAction);
  latestAction.current = onFieldAction;
  const [order, setOrder] = useState(() => [...view.field_ids, ...fields.filter(field => !view.field_ids.includes(field.id)).map(field => field.id)]);
  const [visible, setVisible] = useState(() => new Set(view.field_ids));
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const move = (id: string, target: string, after: boolean) => setOrder(previous => {
    const next = previous.filter(value => value !== id);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, id);
    return next;
  });
  const reorder = usePointerReorder(move);
  async function save(action?: () => void) {
    setBusy(true);
    try { const field_ids = order.filter(id => visible.has(id)); if (!action || JSON.stringify(field_ids) !== JSON.stringify(view.field_ids)) await onSave({ ...view, field_ids }); if (action) action(); else onClose(); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  }
  return <Popover anchor={anchor} label="字段管理" className="w-[340px] p-2" onClose={() => { if (!busy) onClose(); }}>
    <div className="flex flex-col gap-0.5" data-reorder-scope="fields">
      {order.map((id, index) => {
        const field = fields.find(value => value.id === id);
        if (!field) return null;
        const shown = visible.has(id);
        return <div key={id} data-reorder-id={id} data-drop={reorder.target?.id === id ? (reorder.target.after ? "after" : "before") : undefined} className="relative flex min-h-10 items-center gap-2 px-1 data-[drop=before]:[box-shadow:inset_0_2px_var(--sheet-active-border)] data-[drop=after]:[box-shadow:inset_0_-2px_var(--sheet-active-border)]">
          <button type="button" className="inline-flex touch-none cursor-grab items-center justify-center border-0 border-current bg-transparent p-1 text-(--muted-foreground) active:cursor-grabbing disabled:cursor-default disabled:opacity-35 focus-visible:rounded focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)" aria-label={`拖拽排序${field.name}`} title="拖拽排序，也可按上下方向键移动" disabled={busy}
            onPointerDown={event => reorder.start(event, id)} onKeyDown={event => {
              if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault(); const next = order[index + (event.key === "ArrowUp" ? -1 : 1)]; if (next) move(id, next, event.key === "ArrowDown");
            }}><GripVertical size={16} /></button>
          <FieldIcon kind={field.kind} size={18} /><span className={cn("min-w-0 flex-1 truncate", !shown && "text-(--muted-foreground)")}>{field.name}</span>
          <Button className={sheetActionClassName} size="sm" role="checkbox" aria-checked={shown} aria-label={field.name} title={`${shown ? "隐藏" : "显示"}${field.name}`} disabled={busy || (shown && visible.size <= 1)} onClick={() => setVisible(previous => {
            const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
          })} variant="ghost">{shown ? <Eye size={18} /> : <EyeOff size={18} />}</Button>
          <Button className={sheetActionClassName} size="sm" aria-label={`${field.name}字段操作`} aria-expanded={menu === id} onClick={() => setMenu(menu === id ? null : id)} disabled={busy} variant="ghost"><MoreHorizontal size={18} /></Button>
          {menu === id && <div className={cn(sheetMenuClassName, "absolute top-full right-0 z-2 min-w-[130px] rounded-[10px] border border-border bg-card p-1.5 [box-shadow:var(--shadow-lg)]")} role="menu" aria-label={`${field.name}字段操作`}>
            <Button className={sheetMenuActionClassName} role="menuitem" disabled={busy || !onFieldAction} onClick={event => { const at = anchorAt(event.currentTarget); void save(() => latestAction.current?.("edit", field, at)); }} variant="ghost"><Pencil size={16} />编辑</Button>
            <Button className={sheetMenuActionClassName} role="menuitem" disabled={busy || index === 0} onClick={() => { move(id, order[index - 1], false); setMenu(null); }} variant="ghost"><ArrowUp size={16} />上移</Button>
            <Button className={sheetMenuActionClassName} role="menuitem" disabled={busy || index === order.length - 1} onClick={() => { move(id, order[index + 1], true); setMenu(null); }} variant="ghost"><ArrowDown size={16} />下移</Button>
            <Button className={cn(sheetMenuActionClassName, "text-(--destructive)")} role="menuitem" disabled={busy || fields.length <= 1 || !onFieldAction} onClick={event => { const at = anchorAt(event.currentTarget); void save(() => latestAction.current?.("delete", field, at)); }} variant="ghost"><Trash2 size={16} />删除</Button>
          </div>}
        </div>;
      })}
    </div>
    <footer className="mt-2 flex justify-end gap-2 border-t border-border px-1 pt-2"><Button size="sm" disabled={busy} onClick={onClose}>取消</Button><Button size="sm" variant="default"  onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}>{busy ? <Spinner aria-hidden="true" /> : null}应用</Button></footer>
  </Popover>;
}
