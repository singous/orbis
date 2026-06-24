import { render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";

import { EditorToolbar } from "./EditorToolbar";

function createEditorStub(): Editor {
  const chain = {
    focus: () => chain,
    setParagraph: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleStrike: () => chain,
    toggleCode: () => chain,
    toggleHeading: () => chain,
    toggleBulletList: () => chain,
    toggleOrderedList: () => chain,
    toggleTaskList: () => chain,
    toggleBlockquote: () => chain,
    toggleCodeBlock: () => chain,
    setHorizontalRule: () => chain,
    setLink: () => chain,
    unsetLink: () => chain,
    insertTable: () => chain,
    addRowAfter: () => chain,
    addColumnAfter: () => chain,
    deleteTable: () => chain,
    run: () => true,
  };

  return {
    isActive: () => false,
    can: () => ({ chain: () => chain }),
    chain: () => chain,
    getAttributes: () => ({}),
  } as unknown as Editor;
}

describe("EditorToolbar", () => {
  it("exposes the complete note MVP block set in Chinese", () => {
    render(<EditorToolbar editor={createEditorStub()} />);

    [
      "段落",
      "一级标题",
      "二级标题",
      "三级标题",
      "任务列表",
      "分割线",
      "插入表格",
      "添加行",
      "添加列",
      "删除表格",
      "链接",
      "删除线",
      "行内代码",
    ].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
  });
});
