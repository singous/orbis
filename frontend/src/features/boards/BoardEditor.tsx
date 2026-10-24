import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Tabs } from "@heroui/react/tabs";
import { Toolbar } from "@heroui/react/toolbar";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToastNotification } from "../../shared/ui/Toast";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Tooltip } from "../../shared/ui/Tooltip";
import { newUUID } from "../../shared/ids";
import { selectionForCopy, selectionForLayout } from "./transforms";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useStore } from "zustand";
import {
  Check,
  Copy,
  Download,
  History,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Settings2,
  Trash2,
  Undo2,
  X,
  MessageSquare,
  ImagePlus,
  Layers,
  LayoutTemplate,
  Network,
} from "lucide-react";
import {
  RiCursorLine,
  RiHand,
  RiAddCircleFill,
  RiNodeTree,
  RiText,
  RiPencilLine,
  RiFunctionAddLine,
} from "@remixicon/react";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { boardCanvasBackground, boardCanvasTextColor, DEFAULT_BOARD_BACKGROUND } from "./board-appearance";
import { TemplatePreview } from "./TemplatePreview";
import { zoomAt } from "./viewport";
import { BoardShell } from "./BoardShell";
import { BoardMinimap } from "./BoardMinimap";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "../documents/DocumentShell";
import { ShareButton } from "../sharing/ShareButton";
import { BoardSession } from "./session";
import { BoardCanvas } from "./BoardCanvas";
import { BoardLibrary, type BoardLibraryTab } from "./BoardLibrary";
import { BoardInspector } from "./BoardInspector";
import { BoardRenderer, type Camera } from "./renderer";
import { elementBounds, unionBounds } from "./geometry";
import { makeElement, type Element, type Command } from "./model";
import { cloneElements, TEMPLATES, type Template } from "./templates";
import { autoLayout, mindmapLayout } from "./layout";
import { download, exportPNG, exportSVG } from "./export";
import { boardAPI } from "./api";
import {
  portableFile,
  parsePortable,
  importCommands,
  exportAssets,
  MAX_PORTABLE_BYTES,
} from "./portable";
import { BoardImages } from "./images";
import { insertBoardImage } from "./image-import";
import "./boards.css";

const DocumentComments = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((m) => ({
    default: m.DocumentComments,
  })),
);
const ZOOM_STEP = 1.2;
const STATUS = {
  loading: "正在读取…",
  saved: "已保存",
  saving: "正在同步…",
  offline: "离线，修改保存在本机",
  conflict: "有修改需要处理",
  error: "读取失败",
};
export function BoardEditor({ id }: { id: string }) {
  const auth = useAuthRequest(),
    authRef = useRef(auth);
  authRef.current = auth;
  const credential = useStore(authStore, (s) => s.credentialID),
    user = useStore(authStore, (s) => s.user?.id),
    workspace = useStore(authStore, (s) => s.workspace);
  const identity = { credential, user, workspace };
  const session = useMemo(
    () =>
      new BoardSession(
        id,
        `${identity.credential}:${auth.workspaceId}:${id}`,
        () => authRef.current,
      ),
    [id, identity.credential, auth.workspaceId],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot),
    renderer = useRef<BoardRenderer | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set()),
    [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 1 }),
    [tool, setTool] = useState("select");
  const [error, setError] = useState(""),
    [library, setLibrary] = useState(false),
    [inspector, setInspector] = useState(false),
    [comments, setComments] = useState(false),
    [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<Array<{
      revision: number;
      created_at_ms: number;
    }>>([]),
    [historyOpen, setHistoryOpen] = useState(false),
    [discard, setDiscard] = useState(false),
    [layoutBusy, setLayoutBusy] = useState(false);
  const [libraryTab, setLibraryTab] = useState<BoardLibraryTab>("shapes");
  const inspectorID = useId();
  function selectElements(ids: Set<string>) {
    setSelection(ids);
    if (!ids.size) setInspector(false);
  }
  const layoutAbort = useRef<AbortController | null>(null),
    importRef = useRef<HTMLInputElement>(null),
    lastPage = useRef("");
  const imageTarget = useRef<Element | null>(null);
  const imageInput = useRef<HTMLInputElement>(null),
    images = useRef<BoardImages | null>(null);
  const imageImportOwner = useRef<{ session: BoardSession; abort: AbortController } | null>(null);
  useEffect(() => {
    const owner = { session, abort: new AbortController() };
    imageImportOwner.current = owner;
    return () => {
      owner.abort.abort();
      if (imageImportOwner.current === owner) imageImportOwner.current = null;
    };
  }, [session, state.pageID, state.status === "loading"]);
  useEffect(() => {
    const cache = new BoardImages(() => authRef.current);
    images.current = cache;
    return () => {
      cache.dispose();
      images.current = null;
    };
  }, [credential, auth.workspaceId]);
  const canEdit =
    canMutateWorkspaceContent(identity.workspace) &&
    state.status !== "conflict" &&
    state.status !== "loading" &&
    state.status !== "error";
  const fail = (error: unknown) =>
    setError(error instanceof Error ? error.message : String(error));
  useEffect(() => {
    void session.start(new URLSearchParams(location.search).get("page") ?? "");
    return () => {
      session.dispose();
      layoutAbort.current?.abort();
    };
  }, [session]);
  useEffect(() => {
    if (state.pageID !== lastPage.current) {
      lastPage.current = state.pageID;
      setSelection(new Set());
      setInspector(false);
      setCamera({ x: 80, y: 80, zoom: 1 });
    }
  }, [state.pageID]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (session.getSnapshot().pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [session]);
  const submit = (commands: Command[]) => session.submit(commands);
  function fit() {
    const bounds = unionBounds(
      [...state.elements.values()].map((e) => elementBounds(e, state.elements)),
    );
    if (renderer.current) setCamera(renderer.current.fit(bounds));
  }
  function zoom(next: number) {
    const stage = renderer.current?.stage;
    if (!stage) return;
    setCamera(zoomAt(camera, next, { x: stage.width() / 2, y: stage.height() / 2 }));
  }
  function openLibrary(tab: typeof libraryTab) {
    setLibraryTab(tab);
    setLibrary(current => libraryTab !== tab || !current);
  }
  function center() {
    return (
      renderer.current?.worldPoint({
        x: renderer.current.stage.width() / 2,
        y: renderer.current.stage.height() / 2,
      }) ?? { x: 200, y: 200 }
    );
  }
  function insertTemplate(template: Template) {
    const elements = template.build(state.pageID);
    if (state.elements.size) {
      const origin = center();
      for (const e of elements) {
        if (e.shape_type !== "connector") {
          e.geometry.x += origin.x;
          e.geometry.y += origin.y;
        }
      }
    }
    void submit([{ type: "elements.create", elements }])
      .then(() => {
        selectElements(new Set());
        setLibrary(false);
        setTimeout(() => {
          const current = session.getSnapshot().elements;
          if (renderer.current)
            setCamera(
              renderer.current.fit(
                unionBounds(
                  [...current.values()].map((e) => elementBounds(e, current)),
                ),
              ),
            );
        }, 0);
      })
      .catch(fail);
  }
  async function arrange() {
    setLayoutBusy(true);
    setError("");
    layoutAbort.current?.abort();
    const abort = new AbortController();
    layoutAbort.current = abort;
    try {
      const values = selection.size
        ? selectionForLayout(state.elements, selection)
        : [...state.elements.values()];
      const patches = values.some((e) => e.shape_type.startsWith("mindmap."))
        ? mindmapLayout(values)
        : await autoLayout(values, "RIGHT", abort.signal);
      if (patches.length) await submit([{ type: "layout.apply", patches }]);
    } catch (error) {
      fail(error);
    } finally {
      setLayoutBusy(false);
    }
  }
  async function exportFile(kind: "svg" | "png" | "json") {
    if (!state.board) return;
    setExporting(true);
    try {
      const name = state.board.title.replace(/[\\/:*?"<>|]/g, "-");
      if (kind === "json") {
        const currentPage = state.board.pages.find(
          (p) => p.id === state.pageID,
        )!;
        download(
          await portableFile(
            { ...state.board, pages: [currentPage] },
            [...state.elements.values()],
            auth,
          ),
          name + ".orbis-board.json",
        );
        return;
      }
      const page = state.board.pages.find((p) => p.id === state.pageID)!;
      const svg = await exportSVG(
        [...state.elements.values()],
        page.background,
        exportAssets(auth).url,
      );
      download(
        kind === "svg"
          ? new Blob([svg], { type: "image/svg+xml" })
          : await exportPNG(svg),
        name + "." + kind,
      );
    } catch (error) {
      fail(error);
    } finally {
      setExporting(false);
    }
  }
  if (!state.board)
    return (
      <DocumentShell>
        {state.error ? (
          <div className="board-loading">
            <ToastNotification tone="danger" title="无法打开画板" timeout={0}>
              {state.error}
              <Button onClick={() => void session.start()}>重试</Button>
            </ToastNotification>
          </div>
        ) : <LoadingState label="正在打开画板…" variant="editor" />}
      </DocumentShell>
    );
  const board = state.board,
    page = board.pages.find((p) => p.id === state.pageID) ?? board.pages[0];
  const saveState = (
    <span className={"board-save-state is-" + state.status} role="status">
      {state.status === "saved" ? <Check size={13} /> : null}
      {STATUS[state.status]}
    </span>
  );
  const openHistory = () =>
    void boardAPI(auth)
      .history(id)
      .then((result) => { setHistory(result.items); setHistoryOpen(true); })
      .catch(fail);
  const actions = (
    <>
      <ShareButton
        notebookId={board.collection_id}
        noteId={board.document_id}
        title={board.title}
      />
      <ActionButton
        aria-label="画板评论"
        title="评论"
        aria-pressed={comments}
        onClick={() => setComments(!comments)}
      >
        <MessageSquare size={17} />
      </ActionButton>
      <ActionButton
        aria-label="画板历史"
        title="历史版本"
        onClick={openHistory}
      >
        <History size={17} />
      </ActionButton>
      <ActionButton
        aria-label="画布设置"
        title="画布设置"
        aria-expanded={inspector && !comments && !selection.size}
        aria-controls={inspectorID}
        onClick={() => { setSelection(new Set()); setComments(false); setInspector(true); }}
      >
        <Settings2 size={17} />
      </ActionButton>
      <Dropdown>
        <ActionButton aria-label="导入与导出画板" className="board-export-trigger">
          <Download size={16} /><span>导出</span>
        </ActionButton>
        <Dropdown.Popover placement="bottom end" className="board-export-popover">
          <Dropdown.Menu aria-label="导入与导出画板" onAction={key => {
            if (key === "import") importRef.current?.click();
            else if (key === "svg" || key === "png" || key === "json") void exportFile(key);
          }}>
            <Dropdown.Item id="import" textValue="导入画板文件" isDisabled={!canEdit}><Label>导入画板文件</Label></Dropdown.Item>
            <Dropdown.Item id="svg" textValue="SVG" isDisabled={exporting}><Label>SVG</Label></Dropdown.Item>
            <Dropdown.Item id="png" textValue="PNG" isDisabled={exporting}><Label>PNG</Label></Dropdown.Item>
            <Dropdown.Item id="json" textValue="当前页可编辑文件" isDisabled={exporting}><Label>当前页可编辑文件</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </>
  );
  const selectionActions = selection.size ? (<>

                {selection.size === 1 &&
                state.elements.get([...selection][0])?.shape_type ===
                  "basic.image" ? (
                  <ActionButton
                    onClick={() => {
                      imageTarget.current = state.elements.get(
                        [...selection][0],
                      )!;
                      imageInput.current?.click();
                    }}
                  >
                    替换图片
                  </ActionButton>
                ) : null}{" "}
                <ActionButton
                  title="复制所选对象"
                  aria-label="复制所选对象"
                  disabled={!canEdit || !selection.size}
                  onClick={() => {
                    let copies: Element[];
                    try {
                      copies = cloneElements(
                        selectionForCopy(state.elements, selection),
                        state.pageID,
                        40,
                        40,
                        state.elements,
                      );
                    } catch (error) {
                      fail(error);
                      return;
                    }
                    void submit([{ type: "elements.create", elements: copies }])
                      .then(() =>
                        selectElements(new Set(copies.map((e) => e.id))),
                      )
                      .catch(fail);
                  }}
                >
                  <Copy size={17} />
                </ActionButton>
                <ActionButton
                  title="删除所选对象"
                  aria-label="删除所选对象"
                  disabled={!canEdit || !selection.size}
                  onClick={() =>
                    void submit([
                      {
                        type: "elements.delete",
                        targets: [...selection]
                          .map((id) => state.elements.get(id))
                          .filter((e): e is Element => !!e)
                          .map((e) => ({ id: e.id, version: e.version })),
                      },
                    ])
                      .then(() => selectElements(new Set()))
                      .catch(fail)
                  }
                >
                  <Trash2 size={17} />
                </ActionButton>
                <ActionButton
                  title="设置"
                  aria-label="设置选中对象"
                  aria-expanded={inspector && !comments}
                  aria-controls={inspectorID}
                  onClick={() => { setComments(false); setInspector(true); }}
                >
                  <Settings2 size={17} />
                </ActionButton>
                </>) : null;
  return (
    <BoardShell
      board={board}
      status={saveState}
      actions={actions}
    >
      <section className={"board-workspace" + (inspector || comments ? " has-inspector" : "")}>
        <Tabs className="board-page-host"
        selectedKey={state.pageID}
        onSelectionChange={key => { if (typeof key === "string") void session.switchPage(key).catch(fail); }}
        keyboardActivation="manual"
      >
          <Tabs.ListContainer className="board-page-list-container">
            <Tabs.List aria-label="画板页面">
              {board.pages.map(p => <Tabs.Tab id={p.id} key={p.id}>{p.name}<Tabs.Indicator /></Tabs.Tab>)}
            </Tabs.List>
          </Tabs.ListContainer>
        <Tabs.Panel key={state.pageID} id={state.pageID} className="board-main">
          {library ? (
            <BoardLibrary
              tab={libraryTab}
              onTab={setLibraryTab}
              onClose={() => setLibrary(false)}
              elements={state.elements}
              selection={selection}
              onSelect={(id) => {
                selectElements(new Set([id]));
                const e = state.elements.get(id);
                if (e && renderer.current)
                  setCamera(
                    renderer.current.fit(elementBounds(e, state.elements)),
                  );
              }}
              onShape={(shape) => {
                if (shape === "basic.image") {
                  imageTarget.current = null;
                  imageInput.current?.click();
                } else setTool(shape);
                setLibrary(false);
              }}
              onIcon={(icon) => {
                const p = center(),
                  e = makeElement("basic.rounded", state.pageID, p.x, p.y);
                e.structure.icon_id = icon;
                e.text = icon;
                e.geometry.width = 200;
                e.geometry.height = 100;
                void submit([{ type: "elements.create", elements: [e] }])
                  .then(() => selectElements(new Set([e.id])))
                  .catch(fail);
              }}
              onTemplate={insertTemplate}
              readOnly={!canEdit}
            />
          ) : null}
          <div
            className="board-stage-wrap"
            style={{ backgroundColor: boardCanvasBackground(page.background), "--board-canvas-text": boardCanvasTextColor(page.background) } as CSSProperties}
            onDragOver={(e) => {
              if (canEdit) e.preventDefault();
            }}
            onDrop={(event) => {
              const shape = event.dataTransfer.getData(
                "application/x-orbis-shape",
              );
              if (!shape || !canEdit || !renderer.current) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect(),
                point = renderer.current.worldPoint({
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                });
              if (shape === "basic.image") {
                imageTarget.current = null;
                imageInput.current?.click();
                return;
              }
              const e = makeElement(shape, state.pageID, point.x, point.y);
              void submit([{ type: "elements.create", elements: [e] }])
                .then(() => selectElements(new Set([e.id])))
                .catch(fail);
            }}
          >
            <BoardCanvas
              selectionActions={selectionActions}
              elements={state.elements}
              pageID={state.pageID}
              selection={selection}
              onSelection={selectElements}
              camera={camera}
              onCamera={setCamera}
              tool={tool}
              onTool={setTool}
              submit={submit}
              readOnly={!canEdit}
              rendererRef={renderer}
              onError={fail}
              onUndo={() => void session.undo().catch(fail)}
              onRedo={() => void session.redo().catch(fail)}
              resolveImage={(id) =>
                images.current?.load(id) ??
                Promise.reject(new Error("图片未准备好。"))
              }
            />
            {!state.elements.size && canEdit && tool === "select" && !library ? (
              <div className="board-empty">
                <p>直接开始创作，或选择一个模板</p>
                <div className="board-starter-templates">
                  {TEMPLATES.filter((t) =>
                    [
                      "flow.approval",
                      "mindmap.project",
                      "architecture.three-tier",
                    ].includes(t.id),
                  ).map((t) => (
                    <ActionButton key={t.id} onClick={() => insertTemplate(t)}>
                      <TemplatePreview template={t} />
                      <span>{t.name}</span>
                    </ActionButton>
                  ))}
                  <ActionButton onClick={() => openLibrary("templates")}>
                    <LayoutTemplate size={22} aria-hidden="true" />
                    <span>更多模板</span>
                  </ActionButton>
                </div>
              </div>
            ) : null}
            <Toolbar className="board-zoom" aria-label="画板视图">
              <ActionButton
                aria-label="缩小画板"
                title="缩小画板"
                onClick={() => zoom(camera.zoom / ZOOM_STEP)}
              >
                <Minus size={15} />
              </ActionButton>
              <ActionButton
                onClick={() => zoom(1)}
                aria-label="恢复百分之百缩放"
              >
                {(camera.zoom * 100).toFixed(
                  camera.zoom < 0.01 ? 3 : camera.zoom < 0.1 ? 1 : 0,
                )}
                %
              </ActionButton>
              <ActionButton
                aria-label="放大画板"
                title="放大画板"
                onClick={() => zoom(camera.zoom * ZOOM_STEP)}
              >
                <Plus size={15} />
              </ActionButton>
              <span className="board-separator" />
              <ActionButton aria-label="适应全部内容" title="适应全部内容" onClick={fit}>
                <Maximize size={16} />
              </ActionButton>
            </Toolbar>
            {tool === "connect" ? (
              <div className="board-tool-hint">
                依次点击两个图形，连接到最近的端口
              </div>
            ) : null}
            {tool === "mindmap" ? <div className="board-tool-hint">点击画布创建思维导图，Tab 添加子主题，Enter 添加同级主题。</div> : null}
            <BoardMinimap
              elements={state.elements}
              camera={camera}
              renderer={renderer.current}
              onCamera={setCamera}
            />
            <Toolbar className="board-history-controls" aria-label="画板历史操作">
              <ActionButton
                aria-label="撤销画板操作"
                disabled={!canEdit || !state.canUndo}
                onClick={() => void session.undo().catch(fail)}
              >
                <Undo2 size={17} />
              </ActionButton>
              <ActionButton
                aria-label="重做画板操作"
                disabled={!canEdit || !state.canRedo}
                onClick={() => void session.redo().catch(fail)}
              >
                <Redo2 size={17} />
              </ActionButton>
              <ActionButton aria-label="查看画板历史" onClick={openHistory}>
                <History size={16} />
              </ActionButton>
            </Toolbar>
          </div>
          {inspector && !comments ? (
            <BoardInspector
              id={inspectorID}
              onClose={() => setInspector(false)}
              elements={state.elements}
              selection={selection}
              page={page}
              submit={submit}
              readOnly={!canEdit}
              onError={fail}
            />
          ) : null}
        </Tabs.Panel>
        </Tabs>
        <footer className="board-page-actions">

          <ActionButton
            aria-label="添加画板页面"
            disabled={!canEdit || board.pages.length >= 20}
            onClick={() =>
              void submit([
                {
                  type: "pages.create",
                  page: {
                    id: newUUID(),
                    name: "页面 " + (board.pages.length + 1),
                    background: DEFAULT_BOARD_BACKGROUND,
                    position: board.pages.length,
                    version: 0,
                  },
                },
              ]).catch(fail)
            }
          >
            <Plus size={15} />
          </ActionButton>
          <span className="board-toolbar-spacer" />
          <small>
            {selection.size
              ? `已选择 ${selection.size} 个对象`
              : `${state.elements.size} 个对象`}
          </small>
        </footer>

        <Toolbar className="board-toolbar" orientation="vertical" aria-label="画板工具">
          <ActionButton
            aria-label="切换素材面板"
            title="图形与素材"
            aria-pressed={library && (libraryTab === "shapes" || libraryTab === "icons")}
            onClick={() => openLibrary("shapes")}
          >
            <RiAddCircleFill size={17} />
          </ActionButton>
          <span className="board-separator" />
          {(
            [
              { id: "select", label: "选择", shortcut: "V", Icon: RiCursorLine },
              { id: "pan", label: "移动画布", shortcut: "H", Icon: RiHand },
              { id: "connect", label: "连接线", shortcut: "C", Icon: RiNodeTree },
              { id: "mindmap", label: "思维导图", shortcut: "M", Icon: Network },
              { id: "basic.text", label: "文字", shortcut: "T", Icon: RiText },
              { id: "draw", label: "画笔", shortcut: "P", Icon: RiPencilLine },
            ] as const
          ).map(({ id, label, shortcut, Icon }) => (
            <Tooltip key={id} label={`${label} (${shortcut})`} side="right">
              <ToggleButton
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={label}
                isSelected={tool === id}
                isDisabled={!canEdit && !["select", "pan"].includes(id)}
                onChange={() => { setTool(id); setLibrary(false); }}
              >
                <Icon size={17} />
              </ToggleButton>
            </Tooltip>
          ))}

          <ActionButton
            aria-label="插入图片"
            title="插入图片"
            disabled={!canEdit}
            onClick={() => { imageTarget.current = null; imageInput.current?.click(); }}
          >
            <ImagePlus size={17} />
          </ActionButton>
          <span className="board-separator" />
          <ActionButton
            aria-label="模板库"
            title="模板库"
            aria-pressed={library && libraryTab === "templates"}
            onClick={() => openLibrary("templates")}
          >
            <LayoutTemplate size={17} />
          </ActionButton>
          <ActionButton
            aria-label="页面与图层"
            title="页面与图层"
            aria-pressed={library && libraryTab === "layers"}
            onClick={() => openLibrary("layers")}
          >
            <Layers size={17} />
          </ActionButton>
          <span className="board-separator" />
          <ActionButton
            disabled={!canEdit || layoutBusy || !state.elements.size}
            isPending={layoutBusy}
            aria-label="自动布局"
            title="自动布局"
            onClick={() => void arrange()}
          >
            <RiFunctionAddLine size={16} />
          </ActionButton>
        </Toolbar>
        {error || state.error ? (
          <ToastNotification title="画板操作未完成" tone="danger" timeout={state.pending ? 0 : undefined}>
            <span>{error || state.error}</span>
            {state.pending ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void session.retry().catch(fail)}>
                  重试同步
                </Button>
                <Button size="sm" onClick={() => void exportFile("json")}>
                  导出本机修改
                </Button>
                <Button size="sm" onClick={() => setDiscard(true)}>
                  放弃未同步修改
                </Button>
              </div>
            ) : null}
          </ToastNotification>
        ) : null}

        {comments ? (
          <section className="board-comments">
            <header>
              <strong>画板评论</strong>
              <ActionButton
                aria-label="关闭评论"
                onClick={() => setComments(false)}
              >
                <X size={16} />
              </ActionButton>
            </header>
            <Suspense fallback={<p>正在读取评论…</p>}>
              <DocumentComments
                noteId={board.document_id}
                currentUserId={identity.user ?? ""}
                canManage={canEdit}
              />
            </Suspense>
          </section>
        ) : null}

      </section>
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (!canEdit) return;
          const replacing = imageTarget.current;
          imageTarget.current = null;
          const targetPage = state.pageID,
            point = center();
          const owner = imageImportOwner.current;
          if (!owner) return;
          void insertBoardImage(file, {
            auth, pageId: targetPage, point, replacing, signal: owner.abort.signal,
            isCurrent: () => imageImportOwner.current === owner && session.getSnapshot().pageID === targetPage && session.getSnapshot().status !== "loading",
            submit,
          }).then(id => {
            if (imageImportOwner.current === owner && !owner.abort.signal.aborted)
              selectElements(new Set([id]));
          }).catch(error => {
            if (imageImportOwner.current?.session === session) fail(error);
          });
          event.target.value = "";
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,.orbis-board.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > MAX_PORTABLE_BYTES) {
            fail(new Error("文件超过 32 MiB 导入限制。"));
            event.target.value = "";
            return;
          }
          void file
            .text()
            .then(async (raw) => {
              const file = parsePortable(raw);
              const commands = await importCommands(
                file,
                session.getSnapshot().board!.pages.length,
                auth,
              );
              await submit(commands);
            })
            .catch(fail);
          event.target.value = "";
        }}
      />
      <Dialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) setDiscard(false);
        }}
      >
        <DialogContent title="放弃未同步修改">
          <p>
            将清除这张画板在本机尚未确认的操作，并重新读取服务器版本。可以先导出本机修改。
          </p>
          <Button onClick={() => setDiscard(false)}>继续保留</Button>
          <Button
            variant="danger"
            onClick={() =>
              void session
                .discardPending()
                .then(() => setDiscard(false))
                .catch(fail)
            }
          >
            放弃并重新读取
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <DialogContent title="画板历史">
          <div className="board-history-list">
            {history.map((item) => (
              <div key={item.revision}>
                <span>版本 {item.revision}</span>
                <time>
                  {new Date(item.created_at_ms).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </time>
                <ActionButton
                  onClick={() =>
                    void boardAPI(auth)
                      .snapshot(id, item.revision)
                      .then(async (snapshot) =>
                        download(
                          await portableFile(
                            snapshot.board,
                            snapshot.elements,
                            auth,
                          ),
                          board.title +
                            "-v" +
                            item.revision +
                            ".orbis-board.json",
                        ),
                      )
                      .catch(fail)
                  }
                >
                  导出该版本
                </ActionButton>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
