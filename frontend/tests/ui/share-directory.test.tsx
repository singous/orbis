import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readPublicShare, type PublicShare } from "../../src/features/sharing/api";
import { ShareDirectory } from "../../src/features/sharing/ShareDirectory";

vi.mock("../../src/features/sharing/api", () => ({ readPublicShare: vi.fn() }));

const rootId = "0190a111-1111-7111-8111-111111111111";
const childId = "0190a111-1111-7111-8111-111111111112";
const token = "public-token";
const clients: QueryClient[] = [];

function manifest(id = rootId, title = "目录根"): PublicShare {
  return {
    title: "分享资料",
    root_document_id: rootId,
    root_note_id: rootId,
    directory_version: 7,
    items: [{ id, title, parent_id: id === rootId ? null : rootId, position: 0, sort_order: 0, content_version: 1, updated_at_ms: 1 }],
    pagination: { page: 1, page_size: 20, total: 1, total_pages: 1, has_next: false, has_previous: false },
  };
}

function renderDirectory(data: PublicShare) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><ShareDirectory manifest={data} token={token} selectedId={rootId} /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  vi.clearAllMocks();
});

describe("Public share directory controls", () => {
  it("opens a branch with the keyboard while preserving selected link navigation", async () => {
    vi.mocked(readPublicShare).mockResolvedValue(manifest(childId, "下级文档"));
    const user = userEvent.setup();
    renderDirectory(manifest());
    expect(screen.getByRole("link", { name: "目录根" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "目录根" })).toHaveAttribute("href", `/share/${token}/${rootId}`);

    await user.tab();
    expect(screen.getByRole("button", { name: "展开目录根子目录" })).toHaveFocus();
    await user.keyboard(" ");

    expect(await screen.findByRole("link", { name: "下级文档" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起目录根子目录" })).toHaveAttribute("aria-expanded", "true");
    expect(readPublicShare).toHaveBeenCalledWith(token, expect.any(AbortSignal), { parentId: rootId, page: 1, directoryVersion: 7 });
  });

  it("blocks duplicate load-more requests while retaining paging state", async () => {
    let resolve!: (value: PublicShare) => void;
    vi.mocked(readPublicShare).mockReturnValue(new Promise(value => { resolve = value; }));
    const user = userEvent.setup();
    const data = manifest();
    data.pagination = { page: 1, page_size: 20, total: 21, total_pages: 2, has_next: true, has_previous: false };
    renderDirectory(data);

    const more = screen.getByRole("button", { name: "加载更多目录" });
    await user.click(more);
    expect(more).toBeDisabled();
    await user.click(more);
    expect(readPublicShare).toHaveBeenCalledTimes(1);

    resolve({ ...manifest(childId, "第二页文档"), pagination: { page: 2, page_size: 20, total: 21, total_pages: 2, has_next: false, has_previous: true } });
    expect(await screen.findByRole("link", { name: "第二页文档" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "加载更多目录" })).not.toBeInTheDocument());
  });
});
