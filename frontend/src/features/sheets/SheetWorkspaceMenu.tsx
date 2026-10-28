import { ArrowDown, ArrowUp, Columns3, Copy, FileInput, Filter, Group, LayoutGrid, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { releaseFeatures } from "../../shared/release-features";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Popover, type Anchor } from "./Popover";
import { COLORS, KINDS, type Field, type View } from "./model";

export type SheetMenu = { anchor: Anchor } & (
  | { kind: "field" | "color"; field: Field }
  | { kind: "view"; view: View }
  | { kind: "add" }
);

type Props = {
  menu: SheetMenu;
  busy: boolean;
  fieldCount: number;
  visibleFieldCount: number;
  viewCount: number;
  onClose: () => void;
  onRename: (view: View) => void;
  onDuplicate: (view: View) => void;
  onDelete: (view: View) => void;
  onAdd: (kind: "grid" | "kanban" | "form") => void;
  onColor: (fieldID: string, color: string) => void;
  onFieldAction: (action: string, field: Field, anchor: Anchor) => void;
};

/** Present menu choices; the workspace owns mutations and navigation. */
export function SheetWorkspaceMenu({ menu, busy, fieldCount, visibleFieldCount, viewCount,
  onClose, onRename, onDuplicate, onDelete, onAdd, onColor, onFieldAction }: Props) {
  return (
    <Popover
      anchor={menu.anchor}
      label={menu.kind === "field" ? "列操作" : "视图操作"}
      onClose={() => onClose()}
    >
      <div className="sheet-menu" role="menu">
        {menu.kind === "color" &&
          COLORS.map((color, i) => (
            <ActionButton
              size="sm"
              role="menuitem"
              key={color}
              style={{ color: `var(--sheet-ink-${color})` }}
              onClick={() => {
                onClose();
                onColor(menu.field.id, color);
              }}
            >
              {["绿色", "黄色", "蓝色", "紫色", "粉色", "默认"][i]}
            </ActionButton>
          ))}
        {menu.kind === "add" && (
          <>
            {(["grid", "kanban", "form"] as const).filter(kind => releaseFeatures.sheetForms || kind !== "form").map((kind) => (
              <ActionButton
                size="sm"
                role="menuitem"
                key={kind}
                onClick={() => onAdd(kind)}
              >
                {kind === "grid" ? (
                  <Table2 size={15} />
                ) : kind === "kanban" ? (
                  <LayoutGrid size={15} />
                ) : (
                  <FileInput size={15} />
                )}
                {kind === "grid"
                  ? "表格视图"
                  : kind === "kanban"
                    ? "看板视图"
                    : "表单"}
              </ActionButton>
            ))}
          </>
        )}
        {menu.kind === "view" && (
          <>
            <ActionButton
              size="sm"
              role="menuitem"
              onClick={() => {
                onRename(menu.view);
                onClose();
              }}
            >
              <Pencil size={14} />
              重命名视图
            </ActionButton>
            <ActionButton
              size="sm"
              role="menuitem"
              onClick={() => {
                onClose();
                onDuplicate(menu.view);
              }}
            >
              <Copy size={14} />
              复制视图
            </ActionButton>
            <ActionButton
              size="sm"
              role="menuitem"
              disabled={viewCount < 2}
              onClick={() => {
                onClose();
                onDelete(menu.view);
              }}
            >
              <Trash2 size={14} />
              删除视图
            </ActionButton>
          </>
        )}
        {menu.kind === "field" &&
          [
            { id: "edit", label: "编辑列", icon: Pencil },
            { id: "copy", label: "复制列", icon: Copy },
            { id: "left", label: "向左插入列", icon: Plus },
            { id: "right", label: "向右插入列", icon: Plus },
            { id: "group", label: "按本列分组", icon: Group },
            { id: "filter", label: "按本列筛选", icon: Filter },
            { id: "asc", label: "升序", icon: ArrowUp },
            { id: "desc", label: "降序", icon: ArrowDown },
            { id: "duplicates", label: "高亮重复值", icon: Copy },
            { id: "color", label: "文本颜色", icon: Pencil },
            { id: "hide", label: "隐藏列", icon: Columns3 },
            { id: "delete", label: "删除列", icon: Trash2 },
          ].map((item) => (
            <ActionButton
              size="sm"
              role="menuitem"
              className={
                item.id === "delete" ? "sheet-danger-action" : undefined
              }
              key={item.id}
              disabled={
                busy ||
                (item.id === "group" && menu.field.kind !== "select") ||
                (["asc", "desc", "duplicates"].includes(item.id) &&
                  KINDS[menu.field.kind].multiple) ||
                (item.id === "duplicates" &&
                  KINDS[menu.field.kind].system) ||
                (item.id === "delete" && fieldCount <= 1) ||
                (item.id === "hide" && visibleFieldCount <= 1)
              }
              onClick={() => onFieldAction(item.id, menu.field, menu.anchor)}
            >
              <item.icon size={14} />
              {item.label}
            </ActionButton>
          ))}
      </div>
    </Popover>
  );
}
