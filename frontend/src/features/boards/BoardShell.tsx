import { useState, type ReactNode } from "react";
import { CircleHelp, Shapes } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
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
  if (embedded) return <section className="board-shell board-embedded-shell" aria-label="嵌入画板工作区">
    <div className="board-embedded-status">{status}</div>
    {children}
  </section>;
  return (
    <WorkspaceShell
      sidebar={createNotebookSidebar(board.collection_id, board.document_id)}
      contentLayout="document"
      sectionTitle={
        <div className="board-document-heading">
          <Shapes size={17} aria-hidden="true" />
          <h1 title={board.title}>{board.title}</h1>
          {status}
        </div>
      }
      toolbar={<div className="board-header-actions">{actions}</div>}
    >
      <section className="board-shell" aria-label="画板工作区">
        {children}
        <ActionButton
          className="board-help"
          title="快捷键帮助"
          aria-label="画板快捷键帮助"
          onClick={() => setHelp(true)}
        >
          <CircleHelp size={17} />
        </ActionButton>
      </section>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="画板快捷键">
          <dl className="board-shortcuts">
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
