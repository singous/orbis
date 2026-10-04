import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentPreviewDialog } from "../../src/features/documents/DocumentPreviewDialog";

vi.mock("../../src/shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ accessToken: "test" }) }));
vi.mock("../../src/features/documents/api", () => ({
  getNote: async () => ({ id: "note", title: "保存的标题" }),
  getNoteContent: async () => ({ note_id: "note", blocks: {} }),
}));
vi.mock("../../src/features/content/ContentRenderer", () => ({ ContentRenderer: () => { throw new Error("Renderer failed"); } }));
vi.mock("../../src/features/files/FileContent", () => ({ AuthenticatedFileContent: ({ children }: { children: React.ReactNode }) => children }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("contains renderer failures without unmounting the draft or losing the close action", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Harness() {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    return <><textarea aria-label="当前草稿" defaultValue="未保存内容" /><button onClick={() => setOpen(true)}>预览</button>
      <DocumentPreviewDialog noteId={open ? "note" : null} onClose={() => setOpen(false)} /><output aria-label="路径">{location.pathname}</output></>;
  }
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/documents/note"]}><Harness /></MemoryRouter></QueryClientProvider>);
  const actor = userEvent.setup();
  const draft = screen.getByRole("textbox", { name: "当前草稿" });
  const trigger = screen.getByRole("button", { name: "预览" });
  await actor.click(trigger);
  expect(await screen.findByRole("alert")).toHaveTextContent("正文预览未能显示");
  expect(draft).toHaveValue("未保存内容");
  expect(screen.getByLabelText("路径")).toHaveTextContent("/documents/note");
  await actor.click(screen.getByRole("button", { name: "关闭预览" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(draft).toHaveValue("未保存内容");
});
