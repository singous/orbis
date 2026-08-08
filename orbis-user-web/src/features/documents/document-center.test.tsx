import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { DocumentCenterPage } from "./DocumentCenterPage";

const createNotebook = vi.fn();

vi.mock("./queries", () => ({
  useDocumentGroups: () => ({ data: { items: [{ id: "018ff7c4-a5b6-7000-8000-000000000001", tenant_id: null, workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", owner_id: "018ff7c4-a5b6-7000-8000-000000000003", name: "默认分组", is_default: true, sort_order: 0, status: "active", created_at_ms: 1, updated_at_ms: 1 }] }, isLoading: false, isError: false }),
  useNotebooks: () => ({ data: { items: [{ id: "018ff7c4-a5b6-7000-8000-000000000004", tenant_id: null, workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", owner_id: "018ff7c4-a5b6-7000-8000-000000000003", group_id: "018ff7c4-a5b6-7000-8000-000000000001", title: "产品手册", sort_order: 0, status: "active", created_at_ms: 1, updated_at_ms: 1 }] }, isLoading: false, isError: false }),
  useNoteSearch: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useNoteTree: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useCreateDocumentGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDocumentGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveDocumentGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNotebook: () => ({ mutateAsync: createNotebook, isPending: false }),
  useUpdateNotebook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveNotebook: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><DocumentCenterPage /></MemoryRouter></QueryClientProvider>);
}

describe("DocumentCenterPage", () => {
  beforeEach(() => {
    createNotebook.mockReset();
    createNotebook.mockResolvedValue({ id: "018ff7c4-a5b6-7000-8000-000000000009" });
    authStore.setState({ workspace: { id: "018ff7c4-a5b6-7000-8000-000000000002", name: "私人工作空间", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 } });
  });

  it("renders the approved group and collection hierarchy", () => {
    renderPage();
    expect(screen.getAllByText("默认分组").length).toBeGreaterThan(0);
    expect(screen.getAllByText("产品手册").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "文档中心" })).toBeInTheDocument();
  });

  it("creates a collection inside the selected group", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "+ 文集" }));
    await userEvent.type(screen.getByLabelText("文集名称"), "发布计划");
    await userEvent.click(screen.getByRole("button", { name: "创建文集" }));
    expect(createNotebook).toHaveBeenCalledWith({
      title: "发布计划",
      group_id: "018ff7c4-a5b6-7000-8000-000000000001",
      sort_order: 1,
    });
  });

  it("hides all mutation entry points for a normal member", () => {
    authStore.setState((state) => ({ ...state, workspace: state.workspace ? { ...state.workspace, role: "normal" } : null }));
    renderPage();
    expect(screen.queryByRole("button", { name: "+ 文集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建分组" })).not.toBeInTheDocument();
  });
});
