import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { Download, History, MessageSquare, Settings2 } from "@orbis/ui/icons";
import { Spinner } from "@orbis/ui/spinner";
import { releaseFeatures } from "../../shared/release-features";
import { DocumentSaveStatus } from "../documents/editor/DocumentSaveStatus";
import { BoardHistoryTools, BoardTools, BoardViewTools } from "./BoardControls";
import { BoardShell, type BoardIdentity } from "./BoardShell";
import { boardStageClassName } from "./board-control-styles";

export function BoardLoadingActions() {
  return <>
      {releaseFeatures.documentCollaboration && <>
        <Button disabled aria-label="画板评论" variant="ghost" size="icon"><MessageSquare size={17} /></Button>
        <Button disabled aria-label="画板历史" variant="ghost" size="icon"><History size={17} /></Button>
      </>}
      <Button disabled aria-label="画布设置" variant="ghost" size="icon"><Settings2 size={17} /></Button>
      <Button disabled aria-label="导入与导出画板" className="board-export-trigger shrink-0" variant="ghost">
        <Download size={16} /><span className="[@media(max-width:760px)]:hidden">导出</span>
      </Button>
    </>;
}

export function BoardLoadingCanvas({ embedded, readOnly, onRetry }: {
  embedded?: boolean;
  readOnly?: boolean;
  onRetry?: () => void;
}) {
  return (
      <section className="board-workspace absolute inset-0 overflow-hidden bg-background" aria-label="画布">
        <div className={cn(boardStageClassName, "grid place-items-center px-16 text-sm text-muted-foreground", embedded && "bg-none")} aria-busy={!onRetry}>
          {onRetry ? (
            <div className="flex flex-col items-center gap-3">
              <p role="alert">无法读取画板。</p>
              <Button size="sm" onClick={onRetry}>重试</Button>
            </div>
          ) : (
            <Spinner aria-hidden="true" />
          )}
        </div>
        <BoardTools embedded={embedded} hidden={embedded && readOnly} />
        <BoardViewTools embedded={embedded} />
        <BoardHistoryTools embedded={embedded} hidden={embedded && readOnly} />
      </section>
  );
}

export function BoardLoading({ board }: { board: BoardIdentity }) {
  return <BoardShell board={board} status={<DocumentSaveStatus state="loading" className="board-save-state" />} actions={<BoardLoadingActions />}>
    <BoardLoadingCanvas />
  </BoardShell>;
}
