import { useRef, useState, type ReactNode } from "react";
import { CircleHelp, Shapes } from "@orbis/ui/icons";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@orbis/ui/dialog";
import { createNotebookSidebar } from "../documents/NotebookSectionMenu";
import { WorkspaceShell } from "../workspace/WorkspaceShell";

import type { Board } from "./model";

type Props = {
  board: Board;
  children: ReactNode;
  actions: ReactNode;
  status: ReactNode;
  embedded?: boolean;
};

/** 画板复用笔记本目录；绘图状态和工具仍由画板编辑器管理。 */
export function BoardShell({ board, children, actions, status, embedded }: Props) {
  const [help, setHelp] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const shellClassName = "board-shell @container relative flex-1 min-h-0 overflow-hidden text-[13px] leading-[1.5] text-foreground";
  if (embedded) return <section className={`${shellClassName} board-embedded-shell h-full`} aria-label="嵌入画板工作区">
    <div className="board-embedded-status pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-1.5 [&_button]:pointer-events-auto">{status}</div>
    {children}
  </section>;
  return (
    <WorkspaceShell
      sidebar={createNotebookSidebar(board.collection_id, board.document_id)}
      contentLayout="document"
      sectionTitle={
        <div className="board-document-heading flex min-w-0 items-center gap-2.5 text-(--muted-foreground)">
          <Shapes size={17} aria-hidden="true" className="shrink-0 text-primary" />
          <h1 className="min-w-0 truncate text-[14px] font-semibold text-foreground" title={board.title}>{board.title}</h1>
          {status}
        </div>
      }
      toolbar={<div className="board-header-actions flex items-center gap-1.5 max-[760px]:gap-0.5">{actions}</div>}
    >
      <section className={shellClassName} aria-label="画板工作区">
        {children}
        <Button
          ref={helpButton}
          className="board-help absolute right-3 bottom-3 z-24"
          title="快捷键帮助"
          aria-label="画板快捷键帮助"
          onClick={() => setHelp(true)} variant="ghost" size="icon"
        >
          <CircleHelp size={17} />
        </Button>
      </section>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent  finalFocus={helpButton}><DialogHeader><DialogTitle>{"画板快捷键"}</DialogTitle></DialogHeader>
          <dl className="board-shortcuts grid grid-cols-2 gap-x-5 gap-y-3 [&_dt]:font-medium [&_dd]:text-(--muted-foreground)">
            <dt>V / H / T / P / C</dt>
            <dd>选择 / 平移 / 文字 / 画笔 / 连接线</dd>
            <dt>空格 + 拖动</dt>
            <dd>临时平移画布</dd>
            <dt>Ctrl / ⌘ + 滚轮</dt>
            <dd>以指针为中心缩放</dd>
            <dt>Ctrl / ⌘ + Z</dt>
            <dd>撤销</dd>
            <dt>Ctrl / ⌘ + Shift + Z</dt>
            <dd>重做</dd>
            <dt>Ctrl / ⌘ + C / V</dt>
            <dd>复制 / 粘贴对象</dd>
            <dt>方向键</dt>
            <dd>微调位置，Shift 加速</dd>
            <dt>双击对象</dt>
            <dd>编辑文字</dd>
            <dt>Escape</dt>
            <dd>结束工具并取消选择</dd>
          </dl>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}
