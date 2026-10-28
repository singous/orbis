import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { reportError } from "../../shared/api/request-feedback";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
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
  return <Popover anchor={anchor} label="字段管理" className="sheet-field-manager" onClose={() => { if (!busy) onClose(); }}>
    <div className="sheet-field-list" data-reorder-scope="fields">
      {order.map((id, index) => {
        const field = fields.find(value => value.id === id);
        if (!field) return null;
        const shown = visible.has(id);
        return <div key={id} data-reorder-id={id} data-drop={reorder.target?.id === id ? (reorder.target.after ? "after" : "before") : undefined} className={`sheet-managed-field${shown ? "" : " is-hidden"}`}>
          <button type="button" className="sheet-drag-handle" aria-label={`拖拽排序${field.name}`} title="拖拽排序，也可按上下方向键移动" disabled={busy}
            onPointerDown={event => reorder.start(event, id)} onKeyDown={event => {
              if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault(); const next = order[index + (event.key === "ArrowUp" ? -1 : 1)]; if (next) move(id, next, event.key === "ArrowDown");
            }}><GripVertical size={16} /></button>
          <FieldIcon kind={field.kind} size={18} /><span className="sheet-managed-field-name">{field.name}</span>
          <ActionButton size="sm" role="checkbox" aria-checked={shown} aria-label={field.name} title={`${shown ? "隐藏" : "显示"}${field.name}`} disabled={busy || (shown && visible.size <= 1)} onClick={() => setVisible(previous => {
            const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
          })}>{shown ? <Eye size={18} /> : <EyeOff size={18} />}</ActionButton>
          <ActionButton size="sm" aria-label={`${field.name}字段操作`} aria-expanded={menu === id} onClick={() => setMenu(menu === id ? null : id)} disabled={busy}><MoreHorizontal size={18} /></ActionButton>
          {menu === id && <div className="sheet-managed-field-menu sheet-menu" role="menu" aria-label={`${field.name}字段操作`}>
            <ActionButton role="menuitem" disabled={busy || !onFieldAction} onClick={event => { const at = anchorAt(event.currentTarget); void save(() => latestAction.current?.("edit", field, at)); }}><Pencil size={16} />编辑</ActionButton>
            <ActionButton role="menuitem" disabled={busy || index === 0} onClick={() => { move(id, order[index - 1], false); setMenu(null); }}><ArrowUp size={16} />上移</ActionButton>
            <ActionButton role="menuitem" disabled={busy || index === order.length - 1} onClick={() => { move(id, order[index + 1], true); setMenu(null); }}><ArrowDown size={16} />下移</ActionButton>
            <ActionButton role="menuitem" className="sheet-danger-action" disabled={busy || fields.length <= 1 || !onFieldAction} onClick={event => { const at = anchorAt(event.currentTarget); void save(() => latestAction.current?.("delete", field, at)); }}><Trash2 size={16} />删除</ActionButton>
          </div>}
        </div>;
      })}
    </div>
    <footer className="sheet-field-manager-footer"><Button size="sm" disabled={busy} onClick={onClose}>取消</Button><Button size="sm" variant="primary" isPending={busy} onClick={() => void save()}>应用</Button></footer>
  </Popover>;
}
