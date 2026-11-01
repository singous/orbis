import { cn } from "@orbis/ui/cn";
import { boardPanelStyles } from "./panel-styles";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Shapes, Smile, LayoutTemplate, Layers, X } from "@orbis/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";
import { ActionButton } from "../../shared/ui/ActionButton";
import { BOARD_CATALOG, SHAPES, type Element } from "./model";
import { shapePath } from "./geometry";
import { iconImage, iconIndex, type IconEntry } from "./icons";
import { TemplatePreview } from "./TemplatePreview";
import { TEMPLATES, type Template } from "./templates";
import { observeBoardAppearance } from "./canvas-appearance";
export type BoardLibraryTab = "shapes" | "icons" | "templates" | "layers";
type Props = {
  elements: Map<string, Element>;
  selection: Set<string>;
  onSelect: (id: string) => void;
  onShape: (shape: string) => void;
  onIcon: (icon: string) => void;
  onTemplate: (template: Template) => void;
  readOnly: boolean;
  tab: BoardLibraryTab;
  onTab: (tab: BoardLibraryTab) => void;
  onClose?: () => void;
};
export function ShapeSymbol({ type }: { type: string }) {
  const shape = SHAPES.get(type);
  return (
    <svg viewBox="-8 -8 116 116" aria-hidden="true">
      <path
        d={shapePath(shape?.primitive ?? "rect")}
        fill="var(--ob-surface)"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function BoardLibrary(props: Props) {
  const { tab } = props;
  const [query, setQuery] = useState("");
  const library = useRef<HTMLElement>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  useEffect(() => {
    const sync = (style: CSSStyleDeclaration) => setIconColor(style.getPropertyValue("--ob-board-library-icon-preview").trim());
    sync(getComputedStyle(library.current!));
    return observeBoardAppearance(library.current!, sync);
  }, []);
  const [category, setCategory] = useState(tab === "shapes" ? "basic" : "");
  useEffect(() => {
    setQuery("");
    setCategory(tab === "shapes" ? "basic" : "");
  }, [tab]);
  const normalized = query.trim().toLocaleLowerCase();
  const filters = (
    <>
        <label className={boardPanelStyles.search}>
          <Search size={15} className="pointer-events-none absolute left-2.5 text-(--ob-page-muted-foreground)" />
          <TextInput
            className="min-w-0 ps-8"
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
          <SelectField className={boardPanelStyles.category} density="compact" aria-label="图类型" value={category}
            onChange={setCategory} options={[{ value: "", label: "全部类别" }, ...BOARD_CATALOG.categories.filter(c => tab !== "shapes" || c.id !== "mindmap").map(c => ({ value: c.id, label: c.name }))]} />
        ) : null}
    </>
  );
  return (
    <aside ref={library} className={boardPanelStyles.library} aria-label="画板素材">
      <header className={boardPanelStyles.libraryHeader}>
        <strong className="font-semibold">素材库</strong>
        <ActionButton className={cn(boardPanelStyles.control, "text-(--ob-board-library-close-foreground)")} aria-label="收起素材库" onClick={props.onClose}>
          <X size={16} />
        </ActionButton>
      </header>
      <Tabs value={tab} onValueChange={key => props.onTab(key as BoardLibraryTab)} className={boardPanelStyles.libraryContent}>
        <div className="shrink-0">
          <TabsList className={boardPanelStyles.libraryTabs} aria-label="素材分类">
            {([
              { id: "shapes", name: "图形", Icon: Shapes },
              { id: "icons", name: "图标", Icon: Smile },
              { id: "templates", name: "模板", Icon: LayoutTemplate },
              { id: "layers", name: "图层", Icon: Layers },
            ] as const).map(({ id, name, Icon }) => (
              <TabsTrigger className={boardPanelStyles.libraryTab} value={id} key={id}><Icon size={17} aria-hidden="true" /><span>{name}</span></TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="shapes" className={boardPanelStyles.libraryPanel}>
          {tab === "shapes" ? filters : null}
          {tab === "shapes" ? (
            <div className={boardPanelStyles.shapeGrid}>
              {BOARD_CATALOG.shapes
                .filter(
                  (s) =>
                    s.category !== "mindmap" &&
                    (!category || s.category === category) &&
                    (!normalized ||
                      s.keywords.join(" ").toLowerCase().includes(normalized)),
                )
                .map((shape) => (
                  <div key={shape.id} draggable={!props.readOnly} onDragStart={event => event.dataTransfer.setData("application/x-orbis-shape", shape.id)}>
                    <ActionButton
                      className={cn(boardPanelStyles.control, boardPanelStyles.shapeChoice)}
                      disabled={props.readOnly}
                      onClick={() => props.onShape(shape.id)}
                      title={shape.name}
                    >
                      <ShapeSymbol type={shape.id} />
                      <span>{shape.name}</span>
                    </ActionButton>
                  </div>
                ))}
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="icons" className={boardPanelStyles.libraryPanel}>
          {tab === "icons" ? filters : null}
          {tab === "icons" ? (
            <IconBrowser
              color={iconColor}
              query={normalized}
              onSelect={props.onIcon}
              readOnly={props.readOnly}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="templates" className={boardPanelStyles.libraryPanel}>
          {tab === "templates" ? filters : null}
          {tab === "templates" ? (
            <div className={boardPanelStyles.templateList}>
              {TEMPLATES.filter(
                (t) =>
                  (!category || t.category === category) &&
                  (!normalized ||
                    (t.name + " " + t.description).includes(normalized)),
              ).map((template) => (
                <ActionButton
                  className={cn(boardPanelStyles.control, boardPanelStyles.templateChoice)}
                  key={template.id}
                  disabled={props.readOnly}
                  onClick={() => props.onTemplate(template)}
                >
                  <div className={cn(boardPanelStyles.templateArt, "is-" + template.category)}>
                    <TemplatePreview template={template} />
                    <span className="text-[10px]">
                      {
                        BOARD_CATALOG.categories.find(
                          (c) => c.id === template.category,
                        )?.name
                      }
                    </span>
                  </div>
                  <strong className={boardPanelStyles.templateTitle}>{template.name}</strong>
                  <small className={boardPanelStyles.templateDescription}>{template.description}</small>
                </ActionButton>
              ))}
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="layers" className={boardPanelStyles.libraryPanel}>
          {tab === "layers" ? filters : null}
          {tab === "layers" ? (
            <div className={boardPanelStyles.objectList} role="list" aria-label="画板对象树">
              {[...props.elements.values()]
                .filter(
                  (e) => !normalized || e.text.toLowerCase().includes(normalized),
                )
                .sort((a, b) => b.structure.order - a.structure.order)
                .slice(0, 500)
                .map((e) => (
                  <div role="listitem" key={e.id}>
                    <ActionButton
                      className={cn(boardPanelStyles.control, boardPanelStyles.objectChoice, props.selection.has(e.id) && "is-selected")}
                      onClick={() => props.onSelect(e.id)}
                    >
                      <ShapeSymbol type={e.shape_type} />
                      <span className="truncate">
                        {e.text || SHAPES.get(e.shape_type)?.name || "连接线"}
                      </span>
                    </ActionButton>
                  </div>
                ))}
              {props.elements.size > 500 ? (
                <small>显示前 500 个对象，可搜索定位更多内容。</small>
              ) : null}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
      <footer className={boardPanelStyles.footer}>选择图形后点击画布放置</footer>
    </aside>
  );
}
export function IconThumbnail({ id, color }: { id: string; color: string }) {
  const [url, setURL] = useState("");
  useEffect(() => {
    let active = true;
    void iconImage(id, color)
      .then((image) => {
        if (active) setURL(image.src);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, color]);
  return url ? (
    <img src={url} alt="" width={24} height={24} />
  ) : (
    <span className={boardPanelStyles.iconLoading} />
  );
}
function IconBrowser({
  color,
  query,
  onSelect,
  readOnly,
}: {
  color: string | null;
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
      <p className={boardPanelStyles.resultCount}>
        {error || `${filtered.length.toLocaleString()} 个图标`}
      </p>
      <div ref={scroll} className={boardPanelStyles.iconBrowser}>
        <div style={{ height: rows.getTotalSize(), position: "relative" }}>
          {rows.getVirtualItems().map((row) => (
            <div
              className={boardPanelStyles.iconRow}
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
                <ActionButton
                  className={cn(boardPanelStyles.control, boardPanelStyles.iconChoice)}
                  key={icon.id}
                  title={icon.id}
                  aria-label={"插入图标 " + icon.id}
                  disabled={readOnly}
                  onClick={() => onSelect(icon.id)}
                >
                  {color === null ? <span className={boardPanelStyles.iconLoading} /> : <IconThumbnail id={icon.id} color={color} />}
                </ActionButton>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
