import { useId, useRef, useState } from "react";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogClose, DialogTrigger } from "@orbis/ui/dialog";
import { CommandPopup, CommandInput, CommandList, CommandResult, CommandFooter } from "../../shared/ui/command";
import { FileText } from "../../shared/ui/icons";

/** 固定示例只演示展示契约；查询、排序与导航由实际搜索功能负责。 */
export function CommandExample() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  return <section aria-label="搜索组合" className="grid justify-items-start gap-4 rounded-ob-xl bg-ob-background p-6 text-ob-foreground">
    <h2>搜索组合</h2>
    <p>命名弹窗、输入框和所选结果共用展示契约；功能模块保留查询、输入法和导航状态。</p>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>预览搜索组合</Button></DialogTrigger>
      <CommandPopup preset="workspace" title="搜索组合示例" initialFocus={inputRef}>
        <CommandInput ref={inputRef} aria-label="示例搜索" placeholder="输入关键词…" listId={listId} activeId={`${listId}-document`} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <CommandList id={listId} aria-label="示例结果">
            <CommandResult selected icon={FileText} title="搜索展示契约" path="组件工作台 / 搜索" excerpt="此固定结果展示标题、位置与摘要。" metadata="文档" element={<Button appearance="unstyled" id={`${listId}-document`} tabIndex={-1} onClick={() => setOpen(false)} />} />
          </CommandList>
        </div>
        <CommandFooter><span>固定展示示例</span><DialogClose asChild><Button appearance="unstyled" className="ms-auto rounded-ob-sm px-2 py-1 text-xs">关闭示例</Button></DialogClose></CommandFooter>
      </CommandPopup>
    </Dialog>
  </section>;
}
