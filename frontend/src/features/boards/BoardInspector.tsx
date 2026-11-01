import { cn } from "@orbis/ui/cn";
import { boardPanelStyles } from "./panel-styles";
import { newUUID } from "../../shared/ids";
import { isMindmapTopic, reparentElement, toggleTopicCollapsed } from "./mindmap";
import { removeMember, reorderLane, transformBranch } from "./transforms";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Shapes, X, ArrowUp, ArrowDown } from "@orbis/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { Checkbox } from "@orbis/ui/checkbox";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";
import { ColorField } from "../../shared/ui/ColorField";
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
  id?: string;
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
  type?: "text" | "number" | "color";
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    focused = useRef(false),
    commit = useRef(onCommit),
    lastColorCommit = useRef(value);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
      lastColorCommit.current = value;
    }
  }, [value]);
  if (type === "color") {
    return <ColorField
      label={label}
      className={boardPanelStyles.field}
      value={draft}
      disabled={disabled}
      onChange={color => {
        if (!focused.current) commit.current = onCommit;
        focused.current = true;
        setDraft(color);
      }}
      onChangeEnd={color => {
        focused.current = false;
        if (color !== lastColorCommit.current) {
          lastColorCommit.current = color;
          commit.current(color);
        }
      }}
    />;
  }
  return (
    <label className={boardPanelStyles.field}>
      <span>{label}</span>
      <TextInput
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
  id,
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
  const send = (commands: Command[]) => {
    if (!readOnly) void submit(commands).catch(onError);
  };
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
      id={id}
      className={boardPanelStyles.inspector}
      aria-label="画板属性"
    >
      <header className={boardPanelStyles.inspectorHeader}>
        <span className={boardPanelStyles.inspectorIcon}>
          <Shapes size={17} />
        </span>
        <strong className="flex-1 text-sm leading-[1.5] font-semibold">
          {e
            ? selected.length > 1
              ? `已选择 ${selected.length} 个对象`
              : (SHAPES.get(e.shape_type)?.name ?? "连接线")
            : "页面设置"}
        </strong>
        <ActionButton className={cn(boardPanelStyles.control, "text-(--ob-board-inspector-close-foreground)")} aria-label="关闭属性面板" onClick={onClose}>
          <X size={16} />
        </ActionButton>
      </header>
      <Tabs value={tab} onValueChange={key => setTab(key === "style" ? "style" : "properties")} className={boardPanelStyles.inspectorContent}>
        <div className="shrink-0">
          <TabsList className={boardPanelStyles.inspectorTabs} aria-label="对象设置">
            <TabsTrigger className="flex-1" value="properties">属性</TabsTrigger>
            <TabsTrigger className="flex-1" value="style">样式</TabsTrigger>
          </TabsList>
        </div>
        {!e ? (
          <>
            <TabsContent value="properties" className={boardPanelStyles.propertyPanel}>
              <Field
                label="页面名称"
                value={page.name}
                disabled={readOnly}
                onCommit={(name) =>
                  send([{ type: "pages.update", page: { ...page, name } }])
                }
              />

              <p className={boardPanelStyles.note}>
                选择对象以修改样式。按住空格拖动画布，Ctrl / ⌘ 加滚轮缩放。
              </p>
              <p className={boardPanelStyles.note}>
                {elements.size.toLocaleString()} 个对象
              </p>
            </TabsContent>
            <TabsContent value="style" className={boardPanelStyles.propertyPanel}>
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
            </TabsContent>
          </>
        ) : (
          <>
            <TabsContent value="properties" className={boardPanelStyles.propertyPanel}>
              <fieldset disabled={readOnly}>
                <legend>内容</legend>
                <Field
                  disabled={readOnly}
                  label="文字"
                  value={e.text}
                  onCommit={(text) => patch({ text })}
                />
                {selected.length === 1 && e.shape_type !== "connector" ? (
                  <div className={boardPanelStyles.propertyGrid}>
                    {(["x", "y", "width", "height"] as const).map((key, i) => (
                      <Field
                        disabled={readOnly}
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
                      disabled={readOnly}
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

              {e.shape_type === "connector" ? (
                <fieldset disabled={readOnly}>
                  <legend>连接线</legend>
                  <SelectField label="线型" density="compact" className={boardPanelStyles.field} value={e.structure.route} disabled={readOnly}
                    options={[{ value: "straight", label: "直线" }, { value: "orthogonal", label: "折线" }, { value: "curve", label: "曲线" }]}
                    onChange={value => patch({ structure: { ...e.structure, route: value as Element["structure"]["route"] } })} />
                  {(["start_marker", "end_marker"] as const).map((field, i) => (
                    <SelectField key={field} label={i ? "终点" : "起点"} density="compact" className={boardPanelStyles.field} value={e.structure[field]} disabled={readOnly}
                      options={Object.entries({ none: "无", arrow: "箭头", triangle: "空心三角", diamond: "菱形", circle: "圆点", one: "一", many: "多" }).map(([value, label]) => ({ value, label }))}
                      onChange={value => patch({ structure: { ...e.structure, [field]: value } })} />
                  ))}
                </fieldset>
              ) : null}
              {e.shape_type.startsWith("mindmap.") ? (
                <fieldset disabled={readOnly}>
                  <legend>主题分支</legend>
                  <Checkbox wrapperClassName={boardPanelStyles.check} disabled={readOnly} checked={e.structure.collapsed} onCheckedChange={value => {
                    if (value === e.structure.collapsed) return;
                    if (isMindmapTopic(e)) run(() => toggleTopicCollapsed(e, elements));
                    else patch({ structure: { ...e.structure, collapsed: value } });
                  }}>
                    折叠子主题
                  </Checkbox>
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
                    <div className={boardPanelStyles.member} key={member.id}>
                      <Field
                        disabled={readOnly}
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
                        disabled={readOnly}
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
                      <SelectField aria-label={"字段键 " + (index + 1)} density="compact" className={boardPanelStyles.field} value={member.key} disabled={readOnly}
                        options={[{ value: "", label: "普通字段" }, { value: "primary", label: "主键" }, { value: "foreign", label: "外键" }]}
                        onChange={value => patch({ structure: { ...e.structure, members: e.structure.members.map(m => m.id === member.id ? { ...m, key: value as typeof member.key } : m) } })} />
                      <ActionButton
                        className={boardPanelStyles.control}
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
                        <ArrowUp size={14} aria-hidden="true" />
                      </ActionButton>
                      <ActionButton
                        className={boardPanelStyles.control}
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
                        <ArrowDown size={14} aria-hidden="true" />
                      </ActionButton>
                      <ActionButton
                        className={boardPanelStyles.control}
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
                    className={boardPanelStyles.control}
                    onClick={() =>
                      patch({
                        structure: {
                          ...e.structure,
                          members: [
                            ...e.structure.members,
                            {
                              id: newUUID(),
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
                      className={boardPanelStyles.control}
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
                      className={boardPanelStyles.control}
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
                <SelectField label="父容器" density="compact" className={boardPanelStyles.field} value={e.structure.parent_id ?? ""} disabled={readOnly}
                  options={[{ value: "", label: "无" }, ...[...elements.values()].filter(item => item.id !== e.id && (SHAPES.get(item.shape_type)?.container || item.shape_type.startsWith("mindmap."))).map(item => ({ value: item.id, label: item.text || "未命名容器" }))]}
                  onChange={value => run(() => reparentElement(elements, e, value || null))} />
                <ActionButton
                  className={boardPanelStyles.control}
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
                  className={boardPanelStyles.control}
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
            </TabsContent>
            <TabsContent value="style" className={boardPanelStyles.propertyPanel}>
              <fieldset disabled={readOnly}>
                <legend>样式</legend>
                <div className={boardPanelStyles.propertyGrid}>
                  <Field
                    disabled={readOnly}
                    label="填充颜色"
                    type="color"
                    value={
                      e.style.fill === "transparent" ? "#ffffff" : e.style.fill
                    }
                    onCommit={(value) => style("fill", value)}
                  />
                  <Field
                    disabled={readOnly}
                    label="边框颜色"
                    type="color"
                    value={e.style.stroke}
                    onCommit={(value) => style("stroke", value)}
                  />
                  <Field
                    disabled={readOnly}
                    label="文字颜色"
                    type="color"
                    value={e.style.text_color}
                    onCommit={(value) => style("text_color", value)}
                  />
                  <Field
                    disabled={readOnly}
                    label="字号"
                    type="number"
                    value={String(e.style.font_size)}
                    onCommit={(value) => style("font_size", Number(value))}
                  />
                  <Field
                    disabled={readOnly}
                    label="线宽"
                    type="number"
                    value={String(e.style.stroke_width)}
                    onCommit={(value) => style("stroke_width", Number(value))}
                  />
                </div>
                <Checkbox wrapperClassName={boardPanelStyles.check} disabled={readOnly} checked={e.style.bold} onCheckedChange={value => style("bold", value)}>
                  粗体
                </Checkbox>
                <Checkbox wrapperClassName={boardPanelStyles.check} disabled={readOnly} checked={e.style.dashed} onCheckedChange={value => style("dashed", value)}>
                  虚线
                </Checkbox>
                <SelectField label="文字对齐" density="compact" className={boardPanelStyles.field} value={e.style.align} disabled={readOnly}
                  options={[{ value: "left", label: "左对齐" }, { value: "center", label: "居中" }, { value: "right", label: "右对齐" }]}
                  onChange={value => style("align", value)} />
              </fieldset>
            </TabsContent>
          </>
        )}
      </Tabs>
    </aside>
  );
}
