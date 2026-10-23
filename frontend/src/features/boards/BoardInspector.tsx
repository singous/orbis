import { reparentElement } from "./mindmap";
import { removeMember, reorderLane, transformBranch } from "./transforms";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Shapes, X } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import {
  elementPatch,
  SHAPES,
  type BoardPage,
  type Command,
  type Element,
  type Patch,
  type Style,
} from "./model";
type Props = {
  elements: Map<string, Element>;
  selection: Set<string>;
  page: BoardPage;
  submit: (commands: Command[]) => Promise<void>;
  readOnly: boolean;
  onError: (e: unknown) => void;
  onClose?: () => void;
};
function Field({
  label,
  value,
  onCommit,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    focused = useRef(false),
    commit = useRef(onCommit);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <label className="board-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type={type}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
          commit.current = onCommit;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          if (draft !== value) commit.current(draft);
        }}
        onKeyDown={(e) => {
          if (!e.nativeEvent.isComposing && e.key === "Enter")
            e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function BoardInspector({
  elements,
  selection,
  page,
  submit,
  readOnly,
  onError,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"properties" | "style">("properties");
  const selected = [...selection]
      .map((id) => elements.get(id))
      .filter((e): e is Element => !!e),
    e = selected[0];
  const send = (commands: Command[]) => void submit(commands).catch(onError);
  const run = (build: () => Command[]) => {
    try {
      const commands = build();
      if (commands.length) send(commands);
    } catch (error) {
      onError(error);
    }
  };
  const patch = (change: Omit<Patch, "id" | "expected">) => {
    if (!e) return;
    run(() => {
      const patches = change.geometry
        ? transformBranch(elements, e, change.geometry)
        : [elementPatch(e, {})];
      patches[0] = { ...patches[0], ...change };
      return [{ type: "elements.update", patches }];
    });
  };
  const style = (field: keyof Style, value: Style[keyof Style]) =>
    send([
      {
        type: "elements.update",
        patches: selected.map((item) =>
          elementPatch(item, { style: { ...item.style, [field]: value } }),
        ),
      },
    ]);
  return (
    <aside
      className={"board-inspector inspector-tab-" + tab}
      aria-label="画板属性"
    >
      <header>
        <span className="board-inspector-icon">
          <Shapes size={17} />
        </span>
        <strong>
          {e
            ? selected.length > 1
              ? `已选择 ${selected.length} 个对象`
              : (SHAPES.get(e.shape_type)?.name ?? "连接线")
            : "页面设置"}
        </strong>
        <ActionButton aria-label="关闭属性面板" onClick={onClose}>
          <X size={16} />
        </ActionButton>
      </header>
      <div
        className="board-inspector-tabs"
        role="tablist"
        aria-label="对象设置"
      >
        <button
          role="tab"
          aria-selected={tab === "properties"}
          onClick={() => setTab("properties")}
        >
          属性
        </button>
        <button
          role="tab"
          aria-selected={tab === "style"}
          onClick={() => setTab("style")}
        >
          样式
        </button>
      </div>
      {!e ? (
        <>
          <Field
            label="页面名称"
            value={page.name}
            disabled={readOnly}
            onCommit={(name) =>
              send([{ type: "pages.update", page: { ...page, name } }])
            }
          />
          <Field
            label="页面背景"
            type="color"
            value={
              page.background === "transparent" ? "#ffffff" : page.background
            }
            disabled={readOnly}
            onCommit={(background) =>
              send([{ type: "pages.update", page: { ...page, background } }])
            }
          />
          <p className="board-inspector-note">
            选择对象以修改样式。按住空格拖动画布，Ctrl / ⌘ 加滚轮缩放。
          </p>
          <p className="board-inspector-note">
            {elements.size.toLocaleString()} 个对象
          </p>
        </>
      ) : (
        <>
          <fieldset disabled={readOnly}>
            <legend>内容</legend>
            <Field
              label="文字"
              value={e.text}
              onCommit={(text) => patch({ text })}
            />
            {selected.length === 1 && e.shape_type !== "connector" ? (
              <div className="board-property-grid">
                {(["x", "y", "width", "height"] as const).map((key, i) => (
                  <Field
                    key={key}
                    label={["X", "Y", "宽度", "高度"][i]}
                    type="number"
                    value={String(Math.round(e.geometry[key] * 100) / 100)}
                    onCommit={(value) =>
                      patch({
                        geometry: { ...e.geometry, [key]: Number(value) },
                      })
                    }
                  />
                ))}
                <Field
                  label="旋转角度"
                  type="number"
                  value={String(
                    Math.round((e.geometry.rotation_rad * 180) / Math.PI),
                  )}
                  onCommit={(value) =>
                    patch({
                      geometry: {
                        ...e.geometry,
                        rotation_rad: (Number(value) * Math.PI) / 180,
                      },
                    })
                  }
                />
              </div>
            ) : null}
          </fieldset>
          <fieldset disabled={readOnly}>
            <legend>样式</legend>
            <div className="board-property-grid">
              <Field
                label="填充颜色"
                type="color"
                value={
                  e.style.fill === "transparent" ? "#ffffff" : e.style.fill
                }
                onCommit={(value) => style("fill", value)}
              />
              <Field
                label="边框颜色"
                type="color"
                value={e.style.stroke}
                onCommit={(value) => style("stroke", value)}
              />
              <Field
                label="文字颜色"
                type="color"
                value={e.style.text_color}
                onCommit={(value) => style("text_color", value)}
              />
              <Field
                label="字号"
                type="number"
                value={String(e.style.font_size)}
                onCommit={(value) => style("font_size", Number(value))}
              />
              <Field
                label="线宽"
                type="number"
                value={String(e.style.stroke_width)}
                onCommit={(value) => style("stroke_width", Number(value))}
              />
            </div>
            <label className="board-check">
              <input
                type="checkbox"
                checked={e.style.bold}
                onChange={(event) => style("bold", event.target.checked)}
              />
              粗体
            </label>
            <label className="board-check">
              <input
                type="checkbox"
                checked={e.style.dashed}
                onChange={(event) => style("dashed", event.target.checked)}
              />
              虚线
            </label>
            <label className="board-field">
              <span>文字对齐</span>
              <select
                value={e.style.align}
                onChange={(event) => style("align", event.target.value)}
              >
                <option value="left">左对齐</option>
                <option value="center">居中</option>
                <option value="right">右对齐</option>
              </select>
            </label>
          </fieldset>
          {e.shape_type === "connector" ? (
            <fieldset disabled={readOnly}>
              <legend>连接线</legend>
              <label className="board-field">
                <span>线型</span>
                <select
                  value={e.structure.route}
                  onChange={(event) =>
                    patch({
                      structure: {
                        ...e.structure,
                        route: event.target
                          .value as Element["structure"]["route"],
                      },
                    })
                  }
                >
                  <option value="straight">直线</option>
                  <option value="orthogonal">折线</option>
                  <option value="curve">曲线</option>
                </select>
              </label>
              {(["start_marker", "end_marker"] as const).map((field, i) => (
                <label key={field} className="board-field">
                  <span>{i ? "终点" : "起点"}</span>
                  <select
                    value={e.structure[field]}
                    onChange={(event) =>
                      patch({
                        structure: {
                          ...e.structure,
                          [field]: event.target.value,
                        },
                      })
                    }
                  >
                    {Object.entries({
                      none: "无",
                      arrow: "箭头",
                      triangle: "空心三角",
                      diamond: "菱形",
                      circle: "圆点",
                      one: "一",
                      many: "多",
                    }).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}
          {e.shape_type.startsWith("mindmap.") ? (
            <fieldset disabled={readOnly}>
              <legend>主题分支</legend>
              <label className="board-check">
                <input
                  type="checkbox"
                  checked={e.structure.collapsed}
                  onChange={(event) =>
                    patch({
                      structure: {
                        ...e.structure,
                        collapsed: event.target.checked,
                      },
                    })
                  }
                />
                折叠子主题
              </label>
              <small>在画布中按 Tab 添加子主题，Enter 添加同级主题。</small>
            </fieldset>
          ) : null}
          {["entity", "weak-entity", "class"].includes(
            SHAPES.get(e.shape_type)?.primitive ?? "",
          ) ? (
            <fieldset disabled={readOnly}>
              <legend>
                {e.shape_type.startsWith("er.") ? "实体字段" : "成员"}
              </legend>
              {e.structure.members.map((member, index) => (
                <div className="board-member" key={member.id}>
                  <Field
                    label={"字段名称 " + (index + 1)}
                    value={member.name}
                    onCommit={(name) =>
                      patch({
                        structure: {
                          ...e.structure,
                          members: e.structure.members.map((m) =>
                            m.id === member.id ? { ...m, name } : m,
                          ),
                        },
                      })
                    }
                  />
                  <Field
                    label={"字段类型 " + (index + 1)}
                    value={member.type}
                    onCommit={(type) =>
                      patch({
                        structure: {
                          ...e.structure,
                          members: e.structure.members.map((m) =>
                            m.id === member.id ? { ...m, type } : m,
                          ),
                        },
                      })
                    }
                  />
                  <select
                    aria-label={"字段键 " + (index + 1)}
                    value={member.key}
                    onChange={(event) =>
                      patch({
                        structure: {
                          ...e.structure,
                          members: e.structure.members.map((m) =>
                            m.id === member.id
                              ? {
                                  ...m,
                                  key: event.target.value as
                                    | ""
                                    | "primary"
                                    | "foreign",
                                }
                              : m,
                          ),
                        },
                      })
                    }
                  >
                    <option value="">普通字段</option>
                    <option value="primary">主键</option>
                    <option value="foreign">外键</option>
                  </select>
                  <ActionButton
                    aria-label={"上移字段 " + member.name}
                    disabled={index === 0}
                    onClick={() => {
                      const members = [...e.structure.members];
                      [members[index - 1], members[index]] = [
                        members[index],
                        members[index - 1],
                      ];
                      patch({ structure: { ...e.structure, members } });
                    }}
                  >
                    ↑
                  </ActionButton>
                  <ActionButton
                    aria-label={"下移字段 " + member.name}
                    disabled={index === e.structure.members.length - 1}
                    onClick={() => {
                      const members = [...e.structure.members];
                      [members[index + 1], members[index]] = [
                        members[index],
                        members[index + 1],
                      ];
                      patch({ structure: { ...e.structure, members } });
                    }}
                  >
                    ↓
                  </ActionButton>
                  <ActionButton
                    aria-label={"删除字段 " + member.name}
                    onClick={() =>
                      run(() => [
                        {
                          type: "elements.update",
                          patches: removeMember(elements, e, member.id),
                        },
                      ])
                    }
                  >
                    <Trash2 size={14} />
                  </ActionButton>
                </div>
              ))}
              <ActionButton
                onClick={() =>
                  patch({
                    structure: {
                      ...e.structure,
                      members: [
                        ...e.structure.members,
                        {
                          id: crypto.randomUUID(),
                          name: "新字段",
                          type: "text",
                          key: "",
                        },
                      ],
                    },
                    geometry: {
                      ...e.geometry,
                      height: Math.max(
                        e.geometry.height,
                        60 + (e.structure.members.length + 1) * 24,
                      ),
                    },
                  })
                }
              >
                <Plus size={15} />
                添加字段
              </ActionButton>
            </fieldset>
          ) : null}
          <fieldset disabled={readOnly}>
            <legend>归属与层级</legend>
            {["swimlane.horizontal", "swimlane.vertical"].includes(
              e.shape_type,
            ) ? (
              <div>
                <ActionButton
                  onClick={() =>
                    run(() => {
                      const patches = reorderLane(elements, e, -1);
                      return patches.length
                        ? [{ type: "elements.update", patches }]
                        : [];
                    })
                  }
                >
                  前移泳道
                </ActionButton>
                <ActionButton
                  onClick={() =>
                    run(() => {
                      const patches = reorderLane(elements, e, 1);
                      return patches.length
                        ? [{ type: "elements.update", patches }]
                        : [];
                    })
                  }
                >
                  后移泳道
                </ActionButton>
              </div>
            ) : null}
            <label className="board-field">
              <span>父容器</span>
              <select
                value={e.structure.parent_id ?? ""}
                onChange={(event) =>
                  run(() =>
                    reparentElement(elements, e, event.target.value || null),
                  )
                }
              >
                <option value="">无</option>
                {[...elements.values()]
                  .filter(
                    (item) =>
                      item.id !== e.id &&
                      (SHAPES.get(item.shape_type)?.container ||
                        item.shape_type.startsWith("mindmap.")),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.text || "未命名容器"}
                    </option>
                  ))}
              </select>
            </label>
            <ActionButton
              onClick={() =>
                patch({
                  structure: {
                    ...e.structure,
                    order:
                      Math.max(
                        0,
                        ...[...elements.values()].map((x) => x.structure.order),
                      ) + 1,
                  },
                })
              }
            >
              置于顶层
            </ActionButton>
            <ActionButton
              onClick={() =>
                patch({
                  structure: {
                    ...e.structure,
                    order:
                      Math.min(
                        0,
                        ...[...elements.values()].map((x) => x.structure.order),
                      ) - 1,
                  },
                })
              }
            >
              置于底层
            </ActionButton>
          </fieldset>
        </>
      )}
    </aside>
  );
}
