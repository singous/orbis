import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Shapes, Smile, LayoutTemplate, Layers, X } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { BOARD_CATALOG, SHAPES, type Element } from "./model";
import { shapePath } from "./geometry";
import { iconImage, iconIndex, type IconEntry } from "./icons";
import { TemplatePreview } from "./TemplatePreview";
import { TEMPLATES, type Template } from "./templates";
type Props = {
  elements: Map<string, Element>;
  selection: Set<string>;
  onSelect: (id: string) => void;
  onShape: (shape: string) => void;
  onIcon: (icon: string) => void;
  onTemplate: (template: Template) => void;
  readOnly: boolean;
  initialTab?: "shapes" | "icons" | "templates" | "layers";
  onClose?: () => void;
};
export function ShapeSymbol({ type }: { type: string }) {
  const shape = SHAPES.get(type);
  return (
    <svg viewBox="-8 -8 116 116" aria-hidden="true">
      <path
        d={shapePath(shape?.primitive ?? "rect")}
        fill="var(--surface)"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function BoardLibrary(props: Props) {
  const [tab, setTab] = useState<"shapes" | "icons" | "templates" | "layers">(
      props.initialTab ?? "shapes",
    ),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("flow");
  const normalized = query.trim().toLocaleLowerCase();
  return (
    <aside className="board-library" aria-label="画板素材">
      <header className="board-floating-panel-header">
        <strong>素材库</strong>
        <ActionButton aria-label="收起素材库" onClick={props.onClose}>
          <X size={16} />
        </ActionButton>
      </header>
      <div className="board-library-tabs" role="tablist" aria-label="素材分类">
        {(
          [
            { id: "shapes", name: "图形", Icon: Shapes },
            { id: "icons", name: "图标", Icon: Smile },
            { id: "templates", name: "模板", Icon: LayoutTemplate },
            { id: "layers", name: "图层", Icon: Layers },
          ] as const
        ).map(({ id, name, Icon }) => (
          <ActionButton
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => {
              setTab(id);
              setQuery("");
            }}
          >
            <Icon size={17} />
            <span>{name}</span>
          </ActionButton>
        ))}
      </div>
      <label className="board-search">
        <Search size={15} />
        <input
          aria-label="搜索画板素材"
          placeholder={
            tab === "icons"
              ? "搜索图标，支持中文或英文"
              : "搜索图形、模板或对象"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {tab !== "icons" && tab !== "layers" ? (
        <select
          className="board-category"
          aria-label="图类型"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部类别</option>
          {BOARD_CATALOG.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      {tab === "shapes" ? (
        <div className="board-shape-grid">
          {BOARD_CATALOG.shapes
            .filter(
              (s) =>
                (!category || s.category === category) &&
                (!normalized ||
                  s.keywords.join(" ").toLowerCase().includes(normalized)),
            )
            .map((shape) => (
              <button
                key={shape.id}
                draggable={!props.readOnly}
                disabled={props.readOnly}
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/x-orbis-shape", shape.id)
                }
                onClick={() => props.onShape(shape.id)}
                title={shape.name}
              >
                <ShapeSymbol type={shape.id} />
                <span>{shape.name}</span>
              </button>
            ))}
        </div>
      ) : null}
      {tab === "icons" ? (
        <IconBrowser
          query={normalized}
          onSelect={props.onIcon}
          readOnly={props.readOnly}
        />
      ) : null}
      {tab === "templates" ? (
        <div className="board-template-list">
          {TEMPLATES.filter(
            (t) =>
              (!category || t.category === category) &&
              (!normalized ||
                (t.name + " " + t.description).includes(normalized)),
          ).map((template) => (
            <button
              key={template.id}
              disabled={props.readOnly}
              onClick={() => props.onTemplate(template)}
            >
              <div className={"board-template-art is-" + template.category}>
                <TemplatePreview template={template} />
                <span>
                  {
                    BOARD_CATALOG.categories.find(
                      (c) => c.id === template.category,
                    )?.name
                  }
                </span>
              </div>
              <strong>{template.name}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </div>
      ) : null}
      {tab === "layers" ? (
        <div className="board-object-list" role="list" aria-label="画板对象树">
          {[...props.elements.values()]
            .filter(
              (e) => !normalized || e.text.toLowerCase().includes(normalized),
            )
            .sort((a, b) => b.structure.order - a.structure.order)
            .slice(0, 500)
            .map((e) => (
              <button
                role="listitem"
                key={e.id}
                className={props.selection.has(e.id) ? "is-selected" : ""}
                onClick={() => props.onSelect(e.id)}
              >
                <ShapeSymbol type={e.shape_type} />
                <span>
                  {e.text || SHAPES.get(e.shape_type)?.name || "连接线"}
                </span>
              </button>
            ))}
          {props.elements.size > 500 ? (
            <small>显示前 500 个对象，可搜索定位更多内容。</small>
          ) : null}
        </div>
      ) : null}
      <footer className="board-library-footer">选择图形后点击画布放置</footer>
    </aside>
  );
}
export function IconThumbnail({ id }: { id: string }) {
  const [url, setURL] = useState("");
  useEffect(() => {
    let active = true;
    void iconImage(id, "#475569")
      .then((image) => {
        if (active) setURL(image.src);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return url ? (
    <img src={url} alt="" width={24} height={24} />
  ) : (
    <span className="board-icon-loading" />
  );
}
function IconBrowser({
  query,
  onSelect,
  readOnly,
}: {
  query: string;
  onSelect: (id: string) => void;
  readOnly: boolean;
}) {
  const [items, setItems] = useState<IconEntry[]>([]),
    [error, setError] = useState(""),
    scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void iconIndex()
      .then((index) => {
        if (active) setItems(index.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const filtered = useMemo(
    () =>
      items.filter((icon) =>
        (icon.id + " " + icon.keywords).toLocaleLowerCase().includes(query),
      ),
    [items, query],
  );
  const rows = useVirtualizer({
    count: Math.ceil(filtered.length / 4),
    getScrollElement: () => scroll.current,
    estimateSize: () => 48,
    overscan: 4,
  });
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [query]);
  return (
    <>
      <p className="board-result-count">
        {error || `${filtered.length.toLocaleString()} 个图标`}
      </p>
      <div ref={scroll} className="board-icon-browser">
        <div style={{ height: rows.getTotalSize(), position: "relative" }}>
          {rows.getVirtualItems().map((row) => (
            <div
              className="board-icon-row"
              key={row.key}
              style={{
                position: "absolute",
                top: row.start,
                left: 0,
                right: 0,
                height: row.size,
              }}
            >
              {filtered.slice(row.index * 4, row.index * 4 + 4).map((icon) => (
                <button
                  key={icon.id}
                  title={icon.id}
                  aria-label={"插入图标 " + icon.id}
                  disabled={readOnly}
                  onClick={() => onSelect(icon.id)}
                >
                  <IconThumbnail id={icon.id} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
