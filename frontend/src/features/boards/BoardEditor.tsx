import { cn } from "@orbis/ui/cn";
import { boardFloatingPanelStyles, boardStageClassName } from "./board-control-styles";
import { releaseFeatures } from "../../shared/release-features";
import { ConfirmAction } from "../../shared/ui/ConfirmAction";
import { reportError } from "../../shared/api/request-feedback";
import { DraftActions } from "../../shared/ui/DraftActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { ToolbarButton } from "@orbis/ui/toolbar";

import { newUUID } from "../../shared/ids";
import { selectionForCopy, selectionForLayout } from "./transforms";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  Copy,
  Download,
  History,
  Plus,
  Settings2,
  Trash2,
  X,
  MessageSquare,
  LayoutTemplate,
} from "@orbis/ui/icons";
import { Button } from "@orbis/ui/button";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@orbis/ui/dialog";
import { boardCanvasBackground, boardCanvasTextColor, DEFAULT_BOARD_BACKGROUND } from "./board-appearance";
import { TemplatePreview } from "./TemplatePreview";
import { zoomAt } from "./viewport";
import { BoardPreviewState } from "./BoardPreviewState";
import { BoardShell, type BoardIdentity } from "./BoardShell";
import { BoardHistoryTools, BoardTools, BoardViewTools } from "./BoardControls";
import { BoardLoadingActions, BoardLoadingCanvas } from "./BoardLoading";
import { DocumentSaveStatus, type DocumentStatusState } from "../documents/editor/DocumentSaveStatus";
import { BoardMinimap } from "./BoardMinimap";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { ShareButton } from "../sharing/ShareButton";
import type { BoardSession } from "./session";
import { useBoardSession } from "./use-board-session";
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
import { insertBoardImage } from "./image-import";
import "./boards.css";

const DocumentComments = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((m) => ({
    default: m.DocumentComments,
  })),
);
const boardHeaderActionClassName = "board-header-action shrink-0";
const boardPageBarClassName = "row-start-2 z-16 mb-3 flex h-[34px] items-center gap-0.5 rounded-[7px] border border-(--ob-board-border) bg-card px-1 py-0.5 [box-shadow:var(--shadow-sm)] pointer-coarse:h-[calc(var(--ob-control-height-touch)+6px)]";
const boardStarterActionClassName = "board-starter-action pointer-events-auto h-auto min-w-0 justify-start gap-3 p-3";
const boardToolHintClassName = "board-tool-hint pointer-events-none absolute top-[54px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[5px] border border-(--ob-board-hint-border) bg-card px-2.5 py-1.5 text-[11px] text-(--ob-board-hint-foreground) [@container(max-width:640px)]:top-[58px] [@container(max-width:640px)]:right-3 [@container(max-width:640px)]:left-auto [@container(max-width:640px)]:translate-x-0";

const STATUS = {
  loading: { state: "loading" },
  saved: { state: "saved" },
  saving: { state: "saving", label: "正在同步…" },
  save_failed: { state: "error" },
  conflict: { state: "conflict", label: "有修改需要处理" },
  error: { state: "error", label: "读取失败" },
} satisfies Record<string, { state: DocumentStatusState; label?: string }>;
type EmbeddedBoardOptions = {
  pageID: string;
  blockID?: string;
  frameID?: string;
  readOnly: boolean;
  sessionRef?: RefObject<Pick<BoardSession, "getSnapshot"> | null>;
};
export function BoardEditor({ id, embed, document }: { id: string; embed?: EmbeddedBoardOptions; document?: BoardIdentity }) {
  const { auth, workspace, user, session, state, images } = useBoardSession(id, embed);
  const renderer = useRef<BoardRenderer | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set()),
    [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 1 }),
    [tool, setTool] = useState("select");
  const
    [library, setLibrary] = useState(false),
    [inspector, setInspector] = useState(false),
    [comments, setComments] = useState(false),
    [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<Array<{
      revision: number;
      created_at_ms: number;
    }>>([]),
    [historyOpen, setHistoryOpen] = useState(false),
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
  const imageInput = useRef<HTMLInputElement>(null);
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
    if (!embed) return;
    setSelection(new Set());
    setInspector(false);
    setLibrary(false);
    setComments(false);
    setTool(embed.readOnly ? "pan" : "select");
  }, [embed?.readOnly]);
  const canEdit =
    !embed?.readOnly && canMutateWorkspaceContent(workspace) &&
    state.status !== "conflict" &&
    state.status !== "save_failed" &&
    state.status !== "loading" &&
    state.status !== "error";
  const fail = (error: unknown) => {
    reportError(error);
  };
  const recover = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  };
  useEffect(() => () => { layoutAbort.current?.abort(); }, [session, embed?.pageID]);
  const fittedPage = useRef("");
  useEffect(() => {
    if (!embed || state.status === "loading" || !state.board || fittedPage.current === state.pageID) return;
    const frame = requestAnimationFrame(() => {
      if (!renderer.current) return;
      const target = embed.frameID ? state.elements.get(embed.frameID) : undefined;
      const bounds = target ? elementBounds(target, state.elements) : unionBounds([...state.elements.values()].map(e => elementBounds(e, state.elements)));
      setCamera(renderer.current.fit(bounds));
      fittedPage.current = state.pageID;
    });
    return () => cancelAnimationFrame(frame);
  }, [embed, state.status, state.pageID, state.board, state.elements]);
  useEffect(() => {
    if (state.pageID !== lastPage.current) {
      lastPage.current = state.pageID;
      setSelection(new Set());
      setInspector(false);
      setCamera({ x: 80, y: 80, zoom: 1 });
    }
  }, [state.pageID]);
  const submit = (commands: Command[]) => session.submit(commands);
  function fit() {
    const frame = embed?.frameID ? state.elements.get(embed.frameID) : undefined;
    const bounds = frame ? elementBounds(frame, state.elements) : unionBounds(
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
  if (embed && state.board && state.pageID !== embed.pageID) return <BoardPreviewState role="alert">引用的画板页面已不存在，请重新选择引用页面。</BoardPreviewState>;
  if (!state.board) return (
    <BoardShell board={document} embedded={!!embed}
      status={<DocumentSaveStatus {...STATUS[state.error ? "error" : "loading"]} className="board-save-state" />} actions={<BoardLoadingActions />}>
      <BoardLoadingCanvas embedded={!!embed} readOnly={embed?.readOnly}
        onRetry={state.error ? () => void session.start(embed?.pageID ?? new URLSearchParams(location.search).get("page") ?? "") : undefined}
      />
    </BoardShell>
  );
  const board = state.board,
    page = board.pages.find((p) => p.id === state.pageID) ?? board.pages[0];
  const pendingActions = state.pending ? (
    <DraftActions>
      <section>
        <h3 className="mb-2 text-sm font-semibold">当前修改</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={state.status === "saving" || state.status === "loading"} onClick={() => void recover(() => session.retry())}>重试同步</Button>
          <Button size="sm" onClick={() => void exportFile("json")}>导出当前画板</Button>
          {state.canDiscard ? (
            <ConfirmAction title="放弃未保存修改" description="将放弃当前页面未保存的画板修改，并重新读取服务器版本。可以先导出当前画板。" confirmLabel="放弃并重新读取" disabled={!state.canDiscard} onConfirm={() => session.discardPending()}>
              <Button size="sm">放弃未保存修改</Button>
            </ConfirmAction>
          ) : null}
        </div>
      </section>
    </DraftActions>
  ) : null;
  const saveState = (
    <>
    <DocumentSaveStatus {...STATUS[state.status]} className="board-save-state" />
    {embed ? pendingActions : null}
    {state.pending > 0 && (state.status === "save_failed" || state.status === "conflict") && <Button className={embed ? "" : undefined} size="sm" onClick={event => { event.stopPropagation(); void recover(() => session.retry()); }} variant="ghost">重试保存</Button>}
    </>
  );
  const openHistory = () =>
    void boardAPI(auth)
      .history(id)
      .then((result) => { setHistory(result.items); setHistoryOpen(true); })
      .catch(fail);
  const actions = (
    <>
      {!embed ? pendingActions : null}
      {releaseFeatures.documentSharing && <ShareButton
        notebookId={board.collection_id}
        noteId={board.document_id}
        title={board.title}
      />}
      {releaseFeatures.documentCollaboration && <Button
                    className={boardHeaderActionClassName}
        aria-label="画板评论"
        title="评论"
        aria-pressed={comments}
        onClick={() => setComments(!comments)} variant="ghost" size="icon"
      >
        <MessageSquare size={17} />
      </Button>}
      {releaseFeatures.documentCollaboration && <Button
                    className={boardHeaderActionClassName}
        aria-label="画板历史"
        title="历史版本"
        onClick={openHistory} variant="ghost" size="icon"
      >
        <History size={17} />
      </Button>}
      <Button
        className={boardHeaderActionClassName}
        aria-label="画布设置"
        title="画布设置"
        aria-expanded={inspector && !comments && !selection.size}
        aria-controls={inspectorID}
        onClick={() => { setSelection(new Set()); setComments(false); setInspector(true); }} variant="ghost" size="icon"
      >
        <Settings2 size={17} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button aria-label="导入与导出画板" className={cn(boardHeaderActionClassName, "board-export-trigger")} variant="ghost">
          <Download size={16} /><span className="[@media(max-width:760px)]:hidden">导出</span>
        </Button>} />
        <DropdownMenuContent size="sm" align="end" className="board-export-popover z-(--ob-z-popover) min-w-[180px]" aria-label="导入与导出画板">
          <DropdownMenuItem label="导入画板文件" disabled={!canEdit} onClick={() => importRef.current?.click()}>导入画板文件</DropdownMenuItem>
          <DropdownMenuItem label="SVG" disabled={exporting} onClick={() => void exportFile("svg")}>SVG</DropdownMenuItem>
          <DropdownMenuItem label="PNG" disabled={exporting} onClick={() => void exportFile("png")}>PNG</DropdownMenuItem>
          <DropdownMenuItem label="当前页可编辑文件" disabled={exporting} onClick={() => void exportFile("json")}>当前页可编辑文件</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const selectionActions = selection.size ? (<>

                {selection.size === 1 &&
                state.elements.get([...selection][0])?.shape_type ===
                  "basic.image" ? (
                  <ToolbarButton focusableWhenDisabled={false} render={<Button

                    onClick={() => {
                      imageTarget.current = state.elements.get(
                        [...selection][0],
                      )!;
                      imageInput.current?.click();
                    }} variant="ghost"
                  >
                    替换图片
                  </Button>} />
                ) : null}{" "}
                <ToolbarButton focusableWhenDisabled={false} disabled={!canEdit || !selection.size} render={<Button

                  title="复制所选对象"
                  aria-label="复制所选对象"

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
                  }} variant="ghost" size="icon"
                >
                  <Copy size={17} />
                </Button>} />
                <ToolbarButton focusableWhenDisabled={false} disabled={!canEdit || !selection.size} render={<Button

                  title="删除所选对象"
                  aria-label="删除所选对象"

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
                  } variant="ghost" size="icon"
                >
                  <Trash2 size={17} />
                </Button>} />
                <ToolbarButton focusableWhenDisabled={false} render={<Button

                  title="设置"
                  aria-label="设置选中对象"
                  aria-expanded={inspector && !comments}
                  aria-controls={inspectorID}
                  onClick={() => { setComments(false); setInspector(true); }} variant="ghost" size="icon"
                >
                  <Settings2 size={17} />
                </Button>} />
                </>) : null;
  return (
    <BoardShell
      board={board}
      embedded={!!embed}
      status={saveState}
      actions={actions}
    >
      <section className={cn("board-workspace absolute inset-0 grid grid-cols-[minmax(0,max-content)_max-content_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-background", (inspector || comments) && "has-inspector", embed?.readOnly && "is-embed-reading")}>
        <Tabs className="board-page-host contents"
        value={state.pageID}
        onValueChange={key => { if (!embed && typeof key === "string") void session.switchPage(key).catch(fail); }}
      >
          <div className={cn(boardPageBarClassName, "board-page-list-container col-start-1 mr-1 ml-3 min-w-0", inspector || comments ? "max-w-[calc(100cqw-536px)] [@container(640px<width<=900px)]:max-w-[calc(100cqw-468px)]" : "max-w-[calc(100cqw-168px)]", "[@container(max-width:640px)]:max-w-[calc(100cqw-100px)]", embed?.readOnly && "hidden")}>
            <TabsList className="gap-[3px] p-0" aria-label="画板页面" activateOnFocus={false}>
              {board.pages.filter(p => !embed || p.id === state.pageID).map(p => <TabsTrigger className="whitespace-nowrap pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)" value={p.id} key={p.id}>{p.name}</TabsTrigger>)}
            </TabsList>
          </div>
        <TabsContent key={state.pageID} value={state.pageID} className="board-main absolute inset-0 min-h-0 min-w-0 p-0">
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
            className={cn(boardStageClassName, inspector || comments ? "right-[368px] [@container(640px<width<=900px)]:right-[300px] [@container(max-width:640px)]:right-0" : "right-0")}
            style={{ backgroundColor: boardCanvasBackground(page.background), backgroundImage: embed ? "none" : undefined, "--board-canvas-text": boardCanvasTextColor(page.background) } as CSSProperties}
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
              <div className="board-empty pointer-events-none absolute right-6 bottom-[74px] left-[76px] m-auto max-w-[800px] [@container(max-width:900px)]:max-w-[520px] [@container(max-width:640px)]:right-3">
                <p className="mb-3 text-[12px] text-muted-foreground">直接开始创作，或选择一个模板</p>
                <div className="board-starter-templates grid grid-cols-4 gap-2.5 [@container(max-width:900px)]:grid-cols-2">
                  {TEMPLATES.filter((t) =>
                    [
                      "flow.approval",
                      "mindmap.project",
                      "architecture.three-tier",
                    ].includes(t.id),
                  ).map((t) => (
                    <Button className={boardStarterActionClassName} key={t.id} onClick={() => insertTemplate(t)} variant="ghost">
                      <TemplatePreview template={t} />
                      <span className="truncate">{t.name}</span>
                    </Button>
                  ))}
                  <Button className={boardStarterActionClassName} onClick={() => openLibrary("templates")} variant="ghost">
                    <LayoutTemplate size={22} aria-hidden="true" />
                    <span className="truncate">更多模板</span>
                  </Button>
                </div>
              </div>
            ) : null}
            <BoardViewTools embedded={!!embed} zoom={camera.zoom} onZoom={zoom} onFit={fit} />
            {tool === "connect" ? (
              <div className={boardToolHintClassName}>
                依次点击两个图形，连接到最近的端口
              </div>
            ) : null}
            {tool === "mindmap" ? <div className={boardToolHintClassName}>点击画布创建思维导图，Tab 添加子主题，Enter 添加同级主题。</div> : null}
            <BoardMinimap
              className={embed ? "hidden" : undefined}
              elements={state.elements}
              camera={camera}
              renderer={renderer.current}
              onCamera={setCamera}
            />
            <BoardHistoryTools embedded={!!embed} hidden={embed?.readOnly}
              onUndo={canEdit && state.canUndo ? () => void session.undo().catch(fail) : undefined}
              onRedo={canEdit && state.canRedo ? () => void session.redo().catch(fail) : undefined}
              onHistory={openHistory}
            />
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
        </TabsContent>
        </Tabs>
        <footer className={cn(boardPageBarClassName, "board-page-actions col-start-2", embed?.readOnly && "hidden")}>

          <Button
            className={embed && "hidden"}
            aria-label="添加画板页面"
            disabled={!!embed || !canEdit || board.pages.length >= 20}
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
            } variant="ghost" size="icon"
          >
            <Plus size={15} />
          </Button>
          <span className="board-toolbar-spacer flex-1" />
          <small className="block px-2.5 whitespace-nowrap text-(--muted-foreground) [@container(max-width:640px)]:hidden">
            {selection.size
              ? `已选择 ${selection.size} 个对象`
              : `${state.elements.size} 个对象`}
          </small>
        </footer>

        <BoardTools embedded={!!embed} hidden={embed?.readOnly} canEdit={canEdit} selected={tool}
          libraryTab={library ? libraryTab : undefined} arranging={layoutBusy}
          onSelect={next => { setTool(next); setLibrary(false); }}
          onLibrary={openLibrary}
          onImage={canEdit ? () => { imageTarget.current = null; imageInput.current?.click(); } : undefined}
          onArrange={canEdit && state.elements.size ? () => void arrange() : undefined}
        />

        {comments ? (
          <section className={cn(boardFloatingPanelStyles, "board-comments px-3.5 pb-4")}>
            <header className="mb-3.5 flex min-h-[52px] items-center justify-between gap-[9px] pt-2.5 pb-1.5">
              <strong>画板评论</strong>
              <Button

                aria-label="关闭评论"
                onClick={() => setComments(false)} variant="ghost" size="icon"
              >
                <X size={16} />
              </Button>
            </header>
            <Suspense fallback={<p>正在读取评论…</p>}>
              {releaseFeatures.documentCollaboration && <DocumentComments
                noteId={board.document_id}
                currentUserId={user ?? ""}
                canManage={canEdit}
              />}
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
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <DialogContent ><DialogHeader><DialogTitle>{"画板历史"}</DialogTitle></DialogHeader>
          <div className="board-history-list flex max-h-[60vh] flex-col gap-2 overflow-auto [&>div]:flex [&>div]:items-center [&>div]:gap-3.5 [&>div]:border-b [&>div]:border-border [&>div]:py-2 [&_time]:text-[12px] [&_time]:text-(--muted-foreground)">
            {history.map((item) => (
              <div key={item.revision}>
                <span>版本 {item.revision}</span>
                <time>
                  {new Date(item.created_at_ms).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </time>
                <Button
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
                  } variant="ghost"
                >
                  导出该版本
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </BoardShell>
  );
}
