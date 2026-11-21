import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { Combobox } from "@orbis/ui/combobox";
import { Toolbar, ToolbarButton, ToolbarGroup } from "@orbis/ui/toolbar";
import { Toggle } from "@orbis/ui/toggle";
import { Bold, Code, Image, Italic, Link2, MoreHorizontal, Paperclip, Plus, Redo2, Strikethrough, Table2, Underline, Undo2 } from "../../../shared/ui/icons";
import type { ReactNode, RefObject } from "react";
import { editorToolbarClassName, editorToolbarControlClassName, editorToolbarGroupClassName } from "./editor-control-styles";

const TEXT_MARK_TOOLS = [
  { mark: "bold", label: "粗体", Icon: Bold },
  { mark: "italic", label: "斜体", Icon: Italic },
  { mark: "underline", label: "下划线", Icon: Underline },
  { mark: "strike", label: "删除线", Icon: Strikethrough },
] as const;

function Tool({ title, active, onClick, children }: { title: string; active?: boolean; onClick?: () => void; children: ReactNode }) {
  return <ToolbarButton disabled={!onClick} focusableWhenDisabled={false} className={cn(["重做", "链接", "行内代码", "表格", "上传媒体或附件"].includes(title) && "editor-secondary-tool [@media(max-width:700px)]:hidden")} title={title} aria-label={title} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={onClick} render={<Button variant="ghost" />}>{children}</ToolbarButton>;
}

const paragraphItems = [{value:"paragraph",label:"正文"},{value:"heading:1",label:"标题 1"},{value:"heading:2",label:"标题 2"},{value:"heading:3",label:"标题 3"},{value:"bulletListItem",label:"无序列表"},{value:"numberedListItem",label:"有序列表"},{value:"checkListItem",label:"任务清单"},{value:"quote",label:"引用"},{value:"codeBlock",label:"代码块"}];

type FormatActions = {
  onUndo: () => void;
  onRedo: () => void;
  onParagraph: (value: string) => void;
  onMark: (mark: (typeof TEXT_MARK_TOOLS)[number]["mark"]) => void;
  onLink: () => void;
  onCode: () => void;
  onTable: () => void;
  onUpload: () => void;
  onMore: () => void;
  onInsert: () => void;
};

type Props = {
  active?: Partial<Record<(typeof TEXT_MARK_TOOLS)[number]["mark"] | "link" | "code", boolean>>;
  paragraph?: string;
  actions?: FormatActions;
  moreOpen?: boolean;
  menuOpen?: boolean;
  moreButtonRef?: RefObject<HTMLButtonElement | null>;
  insertButtonRef?: RefObject<HTMLButtonElement | null>;
};

export function DocumentFormatToolbar({ active, paragraph = "paragraph", actions, moreOpen, menuOpen, moreButtonRef, insertButtonRef }: Props) {
  return (<Toolbar className={editorToolbarClassName} aria-label="文档格式">
      <ToolbarGroup className={editorToolbarGroupClassName} aria-label="编辑历史">
        <Tool title="撤销" onClick={actions?.onUndo}><Undo2 size={16} /><span className="hidden min-[1360px]:in-[.document-format-host]:inline">撤销</span></Tool>
        <Tool title="重做" onClick={actions?.onRedo}><Redo2 size={16} /><span className="hidden min-[1360px]:in-[.document-format-host]:inline">重做</span></Tool>
      </ToolbarGroup>
      <Combobox
        value={paragraph}
        disabled={!actions}
        onValueChange={value => { if (value !== null) actions?.onParagraph(value); }}
        items={paragraphItems}
        label="段落类型"
        size="sm"
        className={cn("editor-block-type w-[104px] flex-none [@media(max-width:700px)]:w-[85px]", editorToolbarControlClassName)}
        renderTrigger={trigger => <ToolbarButton focusableWhenDisabled={false} render={trigger} />}
      />
      <ToolbarGroup className={cn(editorToolbarGroupClassName, "editor-text-style-tools")} aria-label="文字样式">
        {TEXT_MARK_TOOLS.map(({ mark, label, Icon }) => <ToolbarButton key={mark} disabled={!actions} focusableWhenDisabled={false} render={<Toggle title={label} aria-label={label}
          pressed={Boolean(active?.[mark])} onPressedChange={() => actions?.onMark(mark)}
          className={cn(editorToolbarControlClassName, mark !== "bold" && "editor-secondary-tool [@media(max-width:700px)]:hidden")}
          onMouseDown={event => event.preventDefault()}><Icon size={16} /></Toggle>} />)}
      </ToolbarGroup>
      <ToolbarGroup className={cn(editorToolbarGroupClassName, "[@media(max-width:700px)]:hidden")} aria-label="行内格式">
        <Tool title="链接" active={active?.link} onClick={actions?.onLink}><Link2 size={16} /></Tool>
        <Tool title="行内代码" active={active?.code} onClick={actions?.onCode}><Code size={16} /></Tool>
      </ToolbarGroup>
      <ToolbarGroup className={cn(editorToolbarGroupClassName, "[@media(max-width:700px)]:hidden")} aria-label="表格与附件">
        <Tool title="表格" onClick={actions?.onTable}><Table2 size={16} /></Tool>
        <Tool title="上传媒体或附件" onClick={actions?.onUpload}><Image size={16} /><Paperclip size={13} /></Tool>
      </ToolbarGroup>
      <ToolbarButton focusableWhenDisabled={false} disabled={!actions} render={<Button ref={moreButtonRef} className={cn(editorToolbarControlClassName, "editor-more-tools hidden [@media(max-width:700px)]:inline-flex")} aria-label="更多格式" aria-expanded={moreOpen} onClick={actions?.onMore} variant="ghost" size="icon"><MoreHorizontal size={17}/></Button>} />
      <ToolbarButton focusableWhenDisabled={false} disabled={!actions} render={<Button ref={insertButtonRef} type="button" className={cn(editorToolbarControlClassName, "orbis-tiptap-insert ml-auto in-[.document-format-host]:ml-0 in-[.document-format-host]:bg-muted [@media(max-width:700px)]:ml-0.5")} aria-label="插入内容" aria-expanded={menuOpen} onClick={actions?.onInsert} variant="ghost"><Plus size={15} />插入</Button>} />
    </Toolbar>
  );
}
