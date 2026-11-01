import { cn } from "@orbis/ui/cn";
import { boardControlStyles, boardFloatingPanelStyles } from "./board-control-styles";
import { releaseFeatures } from "../../shared/release-features";
import { ConfirmAction } from "../../shared/ui/ConfirmAction";
import { reportError } from "../../shared/api/request-feedback";
import { DraftActions } from "../../shared/ui/DraftActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { Toolbar } from "@orbis/ui/toolbar";
import { Toggle } from "@orbis/ui/toggle";

import { LoadingState } from "../../shared/ui/LoadingState";
import { Tooltip } from "../../shared/ui/Tooltip";
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
} from "@orbis/ui/icons";
import {
  RiCursorLine,
  RiHand,
  RiAddCircleFill,
  RiNodeTree,
  RiText,
  RiPencilLine,
  RiFunctionAddLine,
} from "../../shared/ui/icons";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { boardCanvasBackground, boardCanvasTextColor, DEFAULT_BOARD_BACKGROUND } from "./board-appearance";
import { TemplatePreview } from "./TemplatePreview";
import { PREVIEW_ZOOMS } from "./BoardPreviewViewport";
import { zoomAt } from "./viewport";
import { BoardPreviewState } from "./BoardPreviewState";
import { BoardShell } from "./BoardShell";
import { BoardMinimap } from "./BoardMinimap";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "../documents/DocumentShell";
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
const boardToolActionClassName = cn(boardControlStyles(), "board-toolbar-action h-8 w-8 min-h-7 min-w-7 shrink-0 p-0 text-(--ob-board-toolbar-foreground) enabled:hover:bg-(--ob-item-hover-bg) enabled:hover:text-ob-foreground aria-pressed:bg-(--ob-item-selected-bg) aria-pressed:text-ob-foreground [&.board-toolbar-action>svg]:m-0 [&.board-toolbar-action>svg]:size-[17px] [&.board-toolbar-action>svg]:shrink-0");
const boardHeaderActionClassName = cn(boardControlStyles({ context: "header" }), "board-header-action border border-(--ob-board-border) bg-ob-card text-(--ob-page-muted-foreground) [box-shadow:var(--ob-board-header-action-shadow)] enabled:hover:bg-ob-card");
const boardFloatingToolbarClassName = "absolute z-16 flex h-[34px] items-center gap-0.5 rounded-[7px] border border-(--ob-board-border) bg-ob-card px-1 py-0.5 text-(--ob-board-zoom-foreground) [box-shadow:var(--ob-shadow-card)] pointer-coarse:h-[calc(var(--ob-control-height-touch)+6px)]";
const boardPageBarClassName = "row-start-2 z-16 mb-3 flex h-[34px] items-center gap-0.5 rounded-[7px] border border-(--ob-board-border) bg-ob-card px-1 py-0.5 [box-shadow:var(--ob-shadow-card)] pointer-coarse:h-[calc(var(--ob-control-height-touch)+6px)]";
const boardStarterActionClassName = cn(boardControlStyles(), "board-starter-action pointer-events-auto h-auto min-w-0 [justify-content:flex-start] [gap:12px] rounded-lg border border-(--ob-board-border) bg-ob-card p-3 [font:inherit] text-(--ob-page-muted-foreground) [box-shadow:var(--ob-shadow-panel)] enabled:hover:border-ob-primary enabled:hover:bg-ob-card enabled:hover:text-ob-primary [@container(max-width:640px)]:[gap:8px] [@container(max-width:640px)]:p-2.5 [&.board-starter-action>svg]:h-[38px] [&.board-starter-action>svg]:w-[42px] [&.board-starter-action>svg]:shrink-0 [&.board-starter-action>svg]:[@container(max-width:640px)]:size-7");
const boardSeparatorClassName = "board-separator my-1 block h-px w-5 shrink-0 bg-(--ob-board-border)";
const boardToolHintClassName = "board-tool-hint pointer-events-none absolute top-[54px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[5px] border border-(--ob-board-hint-border) bg-ob-card px-2.5 py-1.5 text-[11px] text-(--ob-board-hint-foreground) [@container(max-width:640px)]:top-[58px] [@container(max-width:640px)]:right-3 [@container(max-width:640px)]:left-auto [@container(max-width:640px)]:translate-x-0";

const ZOOM_STEP = 1.2;
const STATUS = {
  loading: "正在读取…",
  saved: "已保存",
  saving: "正在同步…",
  save_failed: "保存失败",
  conflict: "有修改需要处理",
  error: "读取失败",
};
type EmbeddedBoardOptions = {
  pageID: string;
  blockID?: string;
  frameID?: string;
  readOnly: boolean;
  sessionRef?: RefObject<Pick<BoardSession, "getSnapshot"> | null>;
};
export function BoardEditor({ id, embed }: { id: string; embed?: EmbeddedBoardOptions }) {
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
  const LoadingShell = embed ? "div" : DocumentShell;
  if (embed && state.board && state.pageID !== embed.pageID) return <BoardPreviewState role="alert">引用的画板页面已不存在，请重新选择引用页面。</BoardPreviewState>;
  if (!state.board)
    return (
      <LoadingShell {...(!embed ? { loading: true } : {})}>
        {state.error ? (
          <div className="board-loading flex min-h-[360px] flex-col items-center justify-center gap-4 text-(--ob-board-loading-foreground)">
            <Button onClick={() => void session.start(embed?.pageID ?? new URLSearchParams(location.search).get("page") ?? "")}>重试</Button>
          </div>
        ) : <LoadingState label="正在打开画板…" variant="editor" />}
      </LoadingShell>
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
    <span className={cn("board-save-state inline-flex shrink-0 items-center gap-1 text-[11px] font-normal", `is-${state.status}`, state.status === "conflict" || state.status === "error" ? "text-(--ob-board-save-danger)" : state.status === "save_failed" ? "text-(--ob-board-save-warning)" : "text-(--ob-page-muted-foreground)", embed ? "rounded-[5px] bg-ob-card px-[7px] py-1" : "[@media(max-width:760px)]:hidden")} role="status">
      {state.status === "saved" ? <Check size={13} /> : null}
      {STATUS[state.status]}
    </span>
    {embed ? pendingActions : null}
    {state.pending > 0 && (state.status === "save_failed" || state.status === "conflict") && <ActionButton className={embed ? boardControlStyles() : undefined} size="sm" onPress={() => void recover(() => session.retry())}>重试保存</ActionButton>}
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
      {releaseFeatures.documentCollaboration && <ActionButton
                    className={boardHeaderActionClassName}
        aria-label="画板评论"
        title="评论"
        aria-pressed={comments}
        onClick={() => setComments(!comments)}
      >
        <MessageSquare size={17} />
      </ActionButton>}
      {releaseFeatures.documentCollaboration && <ActionButton
                    className={boardHeaderActionClassName}
        aria-label="画板历史"
        title="历史版本"
        onClick={openHistory}
      >
        <History size={17} />
      </ActionButton>}
      <ActionButton
        className={boardHeaderActionClassName}
        aria-label="画布设置"
        title="画布设置"
        aria-expanded={inspector && !comments && !selection.size}
        aria-controls={inspectorID}
        onClick={() => { setSelection(new Set()); setComments(false); setInspector(true); }}
      >
        <Settings2 size={17} />
      </ActionButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ActionButton aria-label="导入与导出画板" className={cn(boardHeaderActionClassName, "board-export-trigger")}>
          <Download size={16} /><span className="[@media(max-width:760px)]:hidden">导出</span>
        </ActionButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="board-export-popover z-(--ob-z-popover) min-w-[180px]" aria-label="导入与导出画板">
          <DropdownMenuItem textValue="导入画板文件" disabled={!canEdit} onSelect={() => importRef.current?.click()}>导入画板文件</DropdownMenuItem>
          <DropdownMenuItem textValue="SVG" disabled={exporting} onSelect={() => void exportFile("svg")}>SVG</DropdownMenuItem>
          <DropdownMenuItem textValue="PNG" disabled={exporting} onSelect={() => void exportFile("png")}>PNG</DropdownMenuItem>
          <DropdownMenuItem textValue="当前页可编辑文件" disabled={exporting} onSelect={() => void exportFile("json")}>当前页可编辑文件</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const selectionActions = selection.size ? (<>

                {selection.size === 1 &&
                state.elements.get([...selection][0])?.shape_type ===
                  "basic.image" ? (
                  <ActionButton
                    className={boardControlStyles()}
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
                  className={boardControlStyles()}
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
                  className={boardControlStyles()}
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
                  className={boardControlStyles()}
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
      embedded={!!embed}
      status={saveState}
      actions={actions}
    >
      <section className={cn("board-workspace absolute inset-0 grid grid-cols-[minmax(0,max-content)_max-content_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-ob-canvas", (inspector || comments) && "has-inspector", embed?.readOnly && "is-embed-reading")}>
        <Tabs className="board-page-host contents"
        value={state.pageID}
        onValueChange={key => { if (!embed && typeof key === "string") void session.switchPage(key).catch(fail); }}
      >
          <div className={cn(boardPageBarClassName, "board-page-list-container col-start-1 mr-1 ml-3 min-w-0", inspector || comments ? "max-w-[calc(100cqw-536px)] [@container(640px<width<=900px)]:max-w-[calc(100cqw-468px)]" : "max-w-[calc(100cqw-168px)]", "[@container(max-width:640px)]:max-w-[calc(100cqw-100px)]", embed?.readOnly && "hidden")}>
            <TabsList className="gap-[3px] p-0" aria-label="画板页面" activateOnFocus={false}>
              {board.pages.filter(p => !embed || p.id === state.pageID).map(p => <TabsTrigger className="h-7 min-h-7 px-2.5 py-0 text-[11px] leading-5 whitespace-nowrap pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)" value={p.id} key={p.id}>{p.name}</TabsTrigger>)}
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
            className={cn("board-stage-wrap absolute inset-0 min-h-0 min-w-0 overflow-hidden", inspector || comments ? "right-[368px] [@container(640px<width<=900px)]:right-[300px] [@container(max-width:640px)]:right-0" : "right-0")}
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
                <p className="mb-3 text-[12px] text-ob-muted-foreground">直接开始创作，或选择一个模板</p>
                <div className="board-starter-templates grid grid-cols-4 gap-2.5 [@container(max-width:900px)]:grid-cols-2">
                  {TEMPLATES.filter((t) =>
                    [
                      "flow.approval",
                      "mindmap.project",
                      "architecture.three-tier",
                    ].includes(t.id),
                  ).map((t) => (
                    <ActionButton className={boardStarterActionClassName} key={t.id} onClick={() => insertTemplate(t)}>
                      <TemplatePreview template={t} />
                      <span className="truncate">{t.name}</span>
                    </ActionButton>
                  ))}
                  <ActionButton className={boardStarterActionClassName} onClick={() => openLibrary("templates")}>
                    <LayoutTemplate size={22} aria-hidden="true" />
                    <span className="truncate">更多模板</span>
                  </ActionButton>
                </div>
              </div>
            ) : null}
            <Toolbar className={cn(boardFloatingToolbarClassName, "board-zoom right-3", embed ? "top-2" : "top-3")} aria-label="画板视图">
              <ActionButton
                className={boardControlStyles()}
                aria-label="缩小画板"
                title="缩小画板"
                onClick={() => zoom(camera.zoom / ZOOM_STEP)}
              >
                <Minus size={15} />
              </ActionButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><ActionButton className={boardControlStyles()} aria-label={`缩放比例 ${Math.round(camera.zoom * 100)}%`}>{Math.round(camera.zoom * 100)}%</ActionButton></DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label="画板缩放比例">
                  {PREVIEW_ZOOMS.map(value => <DropdownMenuItem key={value} textValue={`${value * 100}%`} onSelect={() => zoom(value)}>{value * 100}%</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
              <ActionButton
                className={boardControlStyles()}
                aria-label="放大画板"
                title="放大画板"
                onClick={() => zoom(camera.zoom * ZOOM_STEP)}
              >
                <Plus size={15} />
              </ActionButton>
              <span className="board-separator mx-[3px] my-0 h-4 w-px shrink-0 bg-(--ob-board-border)" />
              <ActionButton className={boardControlStyles()} aria-label="适应全部内容" title="适应全部内容" onClick={fit}>
                <Maximize size={16} />
              </ActionButton>
            </Toolbar>
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
            <Toolbar className={cn(boardFloatingToolbarClassName, "board-history-controls left-3", embed ? "bottom-[38px]" : "top-3", embed?.readOnly && "hidden")} aria-label="画板历史操作">
              <ActionButton
                className={cn(boardControlStyles(), "text-(--ob-board-history-foreground)")}
                aria-label="撤销画板操作"
                disabled={!canEdit || !state.canUndo}
                onClick={() => void session.undo().catch(fail)}
              >
                <Undo2 size={17} />
              </ActionButton>
              <ActionButton
                className={cn(boardControlStyles(), "text-(--ob-board-history-foreground)")}
                aria-label="重做画板操作"
                disabled={!canEdit || !state.canRedo}
                onClick={() => void session.redo().catch(fail)}
              >
                <Redo2 size={17} />
              </ActionButton>
              {releaseFeatures.documentCollaboration && <ActionButton className={cn(boardControlStyles(), "text-(--ob-board-history-foreground)")} aria-label="查看画板历史" onClick={openHistory}>
                <History size={16} />
              </ActionButton>}
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
        </TabsContent>
        </Tabs>
        <footer className={cn(boardPageBarClassName, "board-page-actions col-start-2", embed?.readOnly && "hidden")}>

          <ActionButton
            className={cn(boardControlStyles(), embed && "hidden")}
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
            }
          >
            <Plus size={15} />
          </ActionButton>
          <span className="board-toolbar-spacer flex-1" />
          <small className="block px-2.5 whitespace-nowrap text-(--ob-page-muted-foreground) [@container(max-width:640px)]:hidden">
            {selection.size
              ? `已选择 ${selection.size} 个对象`
              : `${state.elements.size} 个对象`}
          </small>
        </footer>

        <Toolbar className={cn("board-toolbar absolute left-3 z-18 flex w-11 flex-col items-center gap-px overflow-y-auto rounded-[9px] border border-(--ob-board-border) bg-ob-card p-[5px] [box-shadow:var(--ob-shadow-card)] pointer-coarse:w-[calc(var(--ob-control-height-touch)+12px)]", embed ? "top-[52px] bottom-[60px] h-fit max-h-[calc(100%-112px)] [scrollbar-width:thin]" : "top-1/2 max-h-[calc(100%-128px)] -translate-y-1/2 [@container(max-width:640px)]:top-16 [@container(max-width:640px)]:bottom-16 [@container(max-width:640px)]:h-fit [@container(max-width:640px)]:translate-y-0", embed?.readOnly && "hidden")} orientation="vertical" aria-label="画板工具">
          <ActionButton
            className={boardToolActionClassName}
            aria-label="切换素材面板"
            title="图形与素材"
            aria-pressed={library && (libraryTab === "shapes" || libraryTab === "icons")}
            onClick={() => openLibrary("shapes")}
          >
            <RiAddCircleFill size={17} />
          </ActionButton>
          <span className={boardSeparatorClassName} />
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
              <Toggle
                className="aria-pressed:bg-(--ob-item-selected-bg) aria-pressed:text-ob-foreground pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)"
                aria-label={label}
                pressed={tool === id}
                disabled={!canEdit && !["select", "pan"].includes(id)}
                onPressedChange={() => { setTool(id); setLibrary(false); }}
              >
                <Icon size={17} />
              </Toggle>
            </Tooltip>
          ))}

          <ActionButton
            className={boardToolActionClassName}
            aria-label="插入图片"
            title="插入图片"
            disabled={!canEdit}
            onClick={() => { imageTarget.current = null; imageInput.current?.click(); }}
          >
            <ImagePlus size={17} />
          </ActionButton>
          <span className={boardSeparatorClassName} />
          <ActionButton
            className={boardToolActionClassName}
            aria-label="模板库"
            title="模板库"
            aria-pressed={library && libraryTab === "templates"}
            onClick={() => openLibrary("templates")}
          >
            <LayoutTemplate size={17} />
          </ActionButton>
          <ActionButton
            className={boardToolActionClassName}
            aria-label="页面与图层"
            title="页面与图层"
            aria-pressed={library && libraryTab === "layers"}
            onClick={() => openLibrary("layers")}
          >
            <Layers size={17} />
          </ActionButton>
          <span className={boardSeparatorClassName} />
          <ActionButton
            className={boardToolActionClassName}
            disabled={!canEdit || layoutBusy || !state.elements.size}
            isPending={layoutBusy}
            aria-label="自动布局"
            title="自动布局"
            onClick={() => void arrange()}
          >
            <RiFunctionAddLine size={16} />
          </ActionButton>
        </Toolbar>

        {comments ? (
          <section className={cn(boardFloatingPanelStyles, "board-comments px-3.5 pb-4")}>
            <header className="mb-3.5 flex min-h-[52px] items-center justify-between gap-[9px] pt-2.5 pb-1.5">
              <strong>画板评论</strong>
              <ActionButton
                className={boardControlStyles()}
                aria-label="关闭评论"
                onClick={() => setComments(false)}
              >
                <X size={16} />
              </ActionButton>
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
        <DialogContent title="画板历史">
          <div className="board-history-list flex max-h-[60vh] flex-col gap-2 overflow-auto [&>div]:flex [&>div]:items-center [&>div]:gap-3.5 [&>div]:border-b [&>div]:border-ob-border [&>div]:py-2 [&_time]:text-[12px] [&_time]:text-(--ob-page-muted-foreground)">
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
