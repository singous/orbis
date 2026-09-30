import { cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, it } from "vitest";
import { EditorToolbarFrame, useEditorToolbarHost } from "../../src/features/documents/EditorToolbarHost";

afterEach(cleanup);
function EditorFixture() {
  const host = useEditorToolbarHost();
  const toolbar = <div role="toolbar" aria-label="文档格式">格式控件</div>;
  return <article>{host ? createPortal(toolbar, host) : toolbar}<p>正文</p></article>;
}

it("mounts formatting controls outside the independently scrolling document", () => {
  const view = render(<EditorToolbarFrame><EditorFixture /></EditorToolbarFrame>);
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.closest(".document-format-host")).not.toBeNull();
  expect(toolbar.closest(".document-scroll-region")).toBeNull();
  expect(screen.getByText("正文").closest(".document-scroll-region")).not.toBeNull();
  view.rerender(<EditorToolbarFrame><EditorFixture /></EditorToolbarFrame>);
  expect(screen.getByRole("toolbar")).toBe(toolbar);
});

it("allows an editor outside the document shell to retain an inline toolbar", () => {
  const view = render(<EditorFixture />);
  expect(view.getByRole("toolbar").closest("article")).not.toBeNull();
});
