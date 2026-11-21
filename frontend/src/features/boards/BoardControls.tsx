import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { History, ImagePlus, Layers, LayoutTemplate, Maximize, Minus, Network, Plus, Redo2, Undo2 } from "@orbis/ui/icons";
import { Spinner } from "@orbis/ui/spinner";
import { Toggle } from "@orbis/ui/toggle";
import { Toolbar, ToolbarButton } from "@orbis/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@orbis/ui/tooltip";
import { releaseFeatures } from "../../shared/release-features";
import { RiAddCircleFill, RiCursorLine, RiFunctionAddLine, RiHand, RiNodeTree, RiPencilLine, RiText } from "../../shared/ui/icons";
import { PREVIEW_ZOOMS } from "./BoardPreviewViewport";
import type { BoardLibraryTab } from "./BoardLibrary";

const actionClassName = "board-toolbar-action shrink-0";
const boardFloatingToolbarClassName = "absolute z-16 flex h-[34px] items-center gap-0.5 rounded-[7px] border border-(--ob-board-border) bg-card px-1 py-0.5 [box-shadow:var(--shadow-sm)] pointer-coarse:h-[calc(var(--ob-control-height-touch)+6px)]";
const separatorClassName = "board-separator my-1 block h-px w-5 shrink-0 bg-(--ob-board-border)";
const zoomStep = 1.2;
const tools = [
  { id: "select", label: "选择", shortcut: "V", Icon: RiCursorLine },
  { id: "pan", label: "移动画布", shortcut: "H", Icon: RiHand },
  { id: "connect", label: "连接线", shortcut: "C", Icon: RiNodeTree },
  { id: "mindmap", label: "思维导图", shortcut: "M", Icon: Network },
  { id: "basic.text", label: "文字", shortcut: "T", Icon: RiText },
  { id: "draw", label: "画笔", shortcut: "P", Icon: RiPencilLine },
] as const;

type BoardToolsProps = {
  embedded?: boolean;
  hidden?: boolean;
  canEdit?: boolean;
  selected?: string;
  libraryTab?: BoardLibraryTab;
  arranging?: boolean;
  onSelect?: (tool: string) => void;
  onLibrary?: (tab: BoardLibraryTab) => void;
  onImage?: () => void;
  onArrange?: () => void;
};

export function BoardTools({ embedded, hidden, canEdit, selected = "select", libraryTab, arranging, onSelect, onLibrary, onImage, onArrange }: BoardToolsProps) {
  return (
    <Toolbar className={cn("board-toolbar absolute left-3 z-18 flex w-11 flex-col items-center gap-px overflow-y-auto rounded-[9px] border border-(--ob-board-border) bg-card p-[5px] [box-shadow:var(--shadow-sm)] pointer-coarse:w-[calc(var(--ob-control-height-touch)+12px)]", embedded ? "top-[52px] bottom-[60px] h-fit max-h-[calc(100%-112px)] [scrollbar-width:thin]" : "top-1/2 max-h-[calc(100%-128px)] -translate-y-1/2 [@container(max-width:640px)]:top-16 [@container(max-width:640px)]:bottom-16 [@container(max-width:640px)]:h-fit [@container(max-width:640px)]:translate-y-0", hidden && "hidden")} orientation="vertical" aria-label="画板工具">
      <ToolbarButton focusableWhenDisabled={false} disabled={!onLibrary} render={<Button className={actionClassName} aria-label="切换素材面板" title="图形与素材" aria-pressed={libraryTab === "shapes" || libraryTab === "icons"} onClick={() => onLibrary?.("shapes")} variant="ghost" size="icon"><RiAddCircleFill size={17} /></Button>} />
      <span className={separatorClassName} />
      {tools.map(({ id, label, shortcut, Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger render={<ToolbarButton focusableWhenDisabled={false} disabled={!onSelect || (!canEdit && id !== "select" && id !== "pan")} render={<Toggle aria-label={label} pressed={selected === id} onPressedChange={() => onSelect?.(id)}><Icon size={17} /></Toggle>} />} />
          <TooltipContent side="right">{`${label} (${shortcut})`}</TooltipContent>
        </Tooltip>
      ))}
      <ToolbarButton focusableWhenDisabled={false} disabled={!onImage} render={<Button className={actionClassName} aria-label="插入图片" title="插入图片" onClick={onImage} variant="ghost" size="icon"><ImagePlus size={17} /></Button>} />
      <span className={separatorClassName} />
      <ToolbarButton focusableWhenDisabled={false} disabled={!onLibrary} render={<Button className={actionClassName} aria-label="模板库" title="模板库" aria-pressed={libraryTab === "templates"} onClick={() => onLibrary?.("templates")} variant="ghost" size="icon"><LayoutTemplate size={17} /></Button>} />
      <ToolbarButton focusableWhenDisabled={false} disabled={!onLibrary} render={<Button className={actionClassName} aria-label="页面与图层" title="页面与图层" aria-pressed={libraryTab === "layers"} onClick={() => onLibrary?.("layers")} variant="ghost" size="icon"><Layers size={17} /></Button>} />
      <span className={separatorClassName} />
      <ToolbarButton focusableWhenDisabled={false} disabled={!onArrange || arranging} render={<Button className={actionClassName} aria-label="自动布局" title="自动布局" onClick={onArrange} aria-busy={arranging || undefined} variant="ghost" size="icon">{arranging ? <Spinner aria-hidden="true" /> : null}<RiFunctionAddLine size={16} /></Button>} />
    </Toolbar>
  );
}

export function BoardViewTools({ embedded, zoom = 1, onZoom, onFit }: { embedded?: boolean; zoom?: number; onZoom?: (zoom: number) => void; onFit?: () => void }) {
  const percentage = Math.round(zoom * 100);
  return (
    <Toolbar className={cn(boardFloatingToolbarClassName, "board-zoom right-3", embedded ? "top-2" : "top-3")} aria-label="画板视图">
      <ToolbarButton focusableWhenDisabled={false} disabled={!onZoom} render={<Button aria-label="缩小画板" title="缩小画板" onClick={() => onZoom?.(zoom / zoomStep)} variant="ghost" size="icon"><Minus size={15} /></Button>} />
      <DropdownMenu>
        <ToolbarButton focusableWhenDisabled={false} disabled={!onZoom} render={<DropdownMenuTrigger render={<Button aria-label={`缩放比例 ${percentage}%`} variant="ghost">{percentage}%</Button>} />} />
        <DropdownMenuContent size="sm" align="end" aria-label="画板缩放比例">
          {PREVIEW_ZOOMS.map(value => <DropdownMenuItem key={value} label={`${value * 100}%`} onClick={() => onZoom?.(value)}>{value * 100}%</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarButton focusableWhenDisabled={false} disabled={!onZoom} render={<Button aria-label="放大画板" title="放大画板" onClick={() => onZoom?.(zoom * zoomStep)} variant="ghost" size="icon"><Plus size={15} /></Button>} />
      <span className="board-separator mx-[3px] my-0 h-4 w-px shrink-0 bg-(--ob-board-border)" />
      <ToolbarButton focusableWhenDisabled={false} disabled={!onFit} render={<Button aria-label="适应全部内容" title="适应全部内容" onClick={onFit} variant="ghost" size="icon"><Maximize size={16} /></Button>} />
    </Toolbar>
  );
}

export function BoardHistoryTools({ embedded, hidden, onUndo, onRedo, onHistory }: { embedded?: boolean; hidden?: boolean; onUndo?: () => void; onRedo?: () => void; onHistory?: () => void }) {
  return (
    <Toolbar className={cn(boardFloatingToolbarClassName, "board-history-controls left-3", embedded ? "bottom-[38px]" : "top-3", hidden && "hidden")} aria-label="画板历史操作">
      <ToolbarButton focusableWhenDisabled={false} disabled={!onUndo} render={<Button aria-label="撤销画板操作" onClick={onUndo} variant="ghost" size="icon"><Undo2 size={17} /></Button>} />
      <ToolbarButton focusableWhenDisabled={false} disabled={!onRedo} render={<Button aria-label="重做画板操作" onClick={onRedo} variant="ghost" size="icon"><Redo2 size={17} /></Button>} />
      {releaseFeatures.documentCollaboration ? <ToolbarButton focusableWhenDisabled={false} disabled={!onHistory} render={<Button aria-label="查看画板历史" onClick={onHistory} variant="ghost" size="icon"><History size={16} /></Button>} /> : null}
    </Toolbar>
  );
}
