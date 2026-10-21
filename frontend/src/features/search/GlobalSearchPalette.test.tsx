import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import type { SearchFilters, SearchResult } from "./api";
import { SearchPaletteProvider, useSearchPalette } from "./search-palette-context";

const mockedSearch = vi.hoisted(() => ({ items: [] as SearchResult[], calls: [] as Array<{ filters: SearchFilters; composing: boolean }>, pending: false }));
vi.mock("./use-palette-search", () => ({
  usePaletteSearch: (filters: SearchFilters, options: { composing: boolean }) => {
    mockedSearch.calls.push({ filters: { ...filters }, composing: options.composing });
    const items = filters.q ? mockedSearch.items : [];
    return {
      results: { data: { items, pagination: { page: 1, page_size: 20, total: items.length, total_pages: items.length ? 1 : 0, has_previous: false, has_next: false } }, isPending: false, isError: false, error: null, refetch: vi.fn() },
      pendingInput: mockedSearch.pending,
      searchedFilters: filters.q ? filters : null,
    };
  },
}));

const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const LOCAL_DOCUMENT_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const editingRoute = "/documents/current-editing-document?mode=edit";
const user = { id: LOCAL_DOCUMENT_ID, bio: null, avatar_asset_id: null, profile_version: 1, email: "owner@orbis.test", display_name: "Owner", preferred_workspace_id: WORKSPACE_ID, created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: WORKSPACE_ID, name: "当前空间", role: "owner" as const, created_at_ms: 1, updated_at_ms: 1 };
const localResult: SearchResult = { id: LOCAL_DOCUMENT_ID, type: "document", workspace_id: WORKSPACE_ID, title: "本空间文档", location: "产品笔记本", snippet: "检索到的保存内容", match: "body", matched_comment_id: null, status: "active", updated_at_ms: 1, collection_id: null, notebook_id: null, group_id: null };

function Background({ initialFilters, prepare, captureNavigate }: { initialFilters: Partial<SearchFilters>; prepare?: () => Promise<void>; captureNavigate: (navigate: (path: string) => void) => void }) {
  const { openSearch } = useSearchPalette();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => prepare ? registerPendingNavigation(prepare) : undefined, [prepare]);
  useEffect(() => captureNavigate(navigate), [captureNavigate, navigate]);
  return <>
    <textarea aria-label="当前编辑草稿" defaultValue="需要保留的未保存草稿" />
    <button onClick={() => openSearch(initialFilters)}>打开全局搜索</button>
    <output aria-label="当前页面">{location.pathname}{location.search}</output>
  </>;
}

function renderPalette({ initialFilters = { q: "检索" }, prepare }: { initialFilters?: Partial<SearchFilters>; prepare?: () => Promise<void> } = {}) {
  let navigate!: (path: string) => void;
  const captureNavigate = (next: (path: string) => void) => { navigate = next; };
  const view = render(<MemoryRouter initialEntries={[editingRoute]}><SearchPaletteProvider><Background initialFilters={initialFilters} prepare={prepare} captureNavigate={captureNavigate} /></SearchPaletteProvider></MemoryRouter>);
  const trigger = screen.getByRole("button", { name: "打开全局搜索" });
  const draft = screen.getByRole("textbox", { name: "当前编辑草稿" });
  const route = screen.getByRole("status", { name: "当前页面" });
  return { ...view, trigger, draft, route, navigate: (path: string) => navigate(path) };
}
async function openPalette(view: ReturnType<typeof renderPalette>) {
  await userEvent.click(view.trigger);
  const input = screen.getByRole("combobox", { name: "搜索任何内容" });
  await waitFor(() => expect(input).toHaveFocus());
  return input;
}
beforeEach(() => {
  mockedSearch.items = [localResult];
  mockedSearch.calls = [];
  mockedSearch.pending = false;
  act(() => authStore.setState({ accessToken: "palette-token", refreshToken: "refresh", user, workspace }));
});
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.restoreAllMocks(); });

describe("global search palette", () => {
  it.each(["escape", "close button"])("opens and closes with %s without saving, changing route or discarding the background draft", async (method) => {
    const prepare = vi.fn(async () => undefined);
    const view = renderPalette({ initialFilters: {}, prepare });
    await openPalette(view);
    expect(view.route).toHaveTextContent(editingRoute);
    expect(view.draft).toHaveValue("需要保留的未保存草稿");
    expect(prepare).not.toHaveBeenCalled();
    if (method === "escape") await userEvent.keyboard("{Escape}");
    else await userEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument());
    await waitFor(() => expect(view.trigger).toHaveFocus());
    expect(view.route).toHaveTextContent(editingRoute);
    expect(view.draft).toHaveValue("需要保留的未保存草稿");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("supports category keyboard selection, recognized aliases and literal unknown @ input", async () => {
    const view = renderPalette({ initialFilters: {} });
    const input = await openPalette(view);
    const categoryList = screen.getByRole("listbox", { name: "搜索内容类型" });
    const categories = within(categoryList).getAllByRole("option");
    expect(categories.map(option => option.querySelector("strong")?.textContent)).toEqual(["@doc", "@notebook", "@group", "@site", "@file"]);
    expect(categories[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(categories[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    expect(categories[4]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", categories[4].id);
    await userEvent.keyboard("{Home}{Enter}");
    expect(input).toHaveValue("@doc ");
    expect(mockedSearch.calls.at(-1)?.filters).toMatchObject({ q: "", type: "document" });
    expect(screen.getByText("输入关键词，搜索文档与评论。")).toBeVisible();
    fireEvent.change(input, { target: { value: "@file 报告" } });
    expect(mockedSearch.calls.at(-1)?.filters).toMatchObject({ q: "报告", type: "file" });
    await userEvent.click(screen.getByRole("button", { name: "清除类型筛选" }));
    expect(input).toHaveValue("报告");
    expect(mockedSearch.calls.at(-1)?.filters).toMatchObject({ q: "报告", type: "all" });
    fireEvent.change(input, { target: { value: "@plugin 配置" } });
    expect(mockedSearch.calls.at(-1)?.filters).toMatchObject({ q: "@plugin 配置", type: "all" });
    expect(view.route).toHaveTextContent(editingRoute);
  });

  it("does not activate Enter while IME composition is active, including native composition events", async () => {
    const prepare = vi.fn(async () => undefined);
    const view = renderPalette({ prepare });
    const input = await openPalette(view);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "@doc 中" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    expect(mockedSearch.calls.at(-1)).toMatchObject({ filters: { q: "中", type: "document" }, composing: true });
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "@doc 中文" } });
    fireEvent.compositionEnd(input, { data: "中文" });
    expect(mockedSearch.calls.at(-1)).toMatchObject({ filters: { q: "中文", type: "document" }, composing: false });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(view.route).toHaveTextContent(`/documents/${LOCAL_DOCUMENT_ID}`));
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("preserves same-workspace links and modifier clicks without flushing the current editor", async () => {
    const prepare = vi.fn(async () => undefined);
    const view = renderPalette({ prepare });
    await openPalette(view);
    const link = screen.getByRole("option", { name: /本空间文档/ });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", `/documents/${LOCAL_DOCUMENT_ID}`);
    const modifiedClick = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    const preventDefault = vi.spyOn(modifiedClick, "preventDefault");
    // Suppress jsdom's unsupported native navigation; the component must not add a cancellation.
    link.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent(link, modifiedClick);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    expect(view.route).toHaveTextContent(editingRoute);
    await userEvent.click(link);
    await waitFor(() => expect(view.route).toHaveTextContent(`/documents/${LOCAL_DOCUMENT_ID}`));
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("uses the global context without another workspace selector or repeated badges", async () => {
    const view = renderPalette();
    await openPalette(view);
    expect(screen.queryByRole("button", { name: /搜索范围/ })).not.toBeInTheDocument();
    expect(screen.queryByText("所有可访问空间")).not.toBeInTheDocument();
    expect(screen.queryByText(workspace.name)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /本空间文档/ })).toHaveTextContent("产品笔记本");
    expect(screen.getByRole("option", { name: /本空间文档/ })).not.toHaveTextContent("切换工作空间");
  });

  it("keeps the palette and background draft after a save error and retries preparation before navigation", async () => {
    const prepare = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("草稿保存失败，请重试")).mockResolvedValueOnce(undefined);
    const view = renderPalette({ prepare });
    const input = await openPalette(view);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿保存失败，请重试");
    expect(view.route).toHaveTextContent(editingRoute);
    expect(view.draft).toHaveValue("需要保留的未保存草稿");
    await waitFor(() => expect(screen.queryByText("正在准备打开…")).not.toBeInTheDocument());
    expect(input).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(view.route).toHaveTextContent(`/documents/${LOCAL_DOCUMENT_ID}`));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"])("ignores a late save %s after closing and reopening the palette", async (completion) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const prepare = vi.fn(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }));
    const view = renderPalette({ prepare });
    await openPalette(view);
    await userEvent.keyboard("{Enter}");
    expect(prepare).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument());
    await openPalette(view);
    await act(async () => { if (completion === "resolve") finish(); else fail(new Error("过期保存错误")); });
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.route).toHaveTextContent(editingRoute);
    expect(view.draft).toHaveValue("需要保留的未保存草稿");
  });

  it.each(["route", "session"])("cancels a pending result when the background %s changes", async (change) => {
    let finish!: () => void;
    const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = renderPalette({ prepare });
    await openPalette(view);
    await userEvent.keyboard("{Enter}");
    act(() => {
      if (change === "route") view.navigate("/home");
      else authStore.getState().setSession({ accessToken: "next-token", refreshToken: "next-refresh", user: { ...user, preferred_workspace_id: OTHER_WORKSPACE_ID }, workspace: { ...workspace, id: OTHER_WORKSPACE_ID } });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument());
    await act(async () => { finish(); });
    expect(view.route).toHaveTextContent(change === "route" ? "/home" : editingRoute);
    expect(view.route.textContent).not.toContain(LOCAL_DOCUMENT_ID);
  });

  it.each(["keyword", "status"])("cancels a pending selection when the %s is refined and allows a new result selection", async (refinement) => {
    let finish!: () => void;
    const prepare = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(undefined);
    const view = renderPalette({ prepare });
    const input = await openPalette(view);
    await userEvent.keyboard("{Enter}");
    expect(prepare).toHaveBeenCalledTimes(1);
    if (refinement === "keyword") fireEvent.change(input, { target: { value: "新的关键词" } });
    else {
      await userEvent.click(screen.getByRole("button", { name: /内容状态/ }));
      await userEvent.click(screen.getByRole("option", { name: "已归档" }));
    }
    await waitFor(() => expect(screen.queryByText("正在准备打开…")).not.toBeInTheDocument());
    await act(async () => { finish(); });
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    expect(view.route).toHaveTextContent(editingRoute);
    expect(view.draft).toHaveValue("需要保留的未保存草稿");
    await userEvent.click(screen.getByRole("option", { name: /本空间文档/ }));
    await waitFor(() => expect(view.route).toHaveTextContent(`/documents/${LOCAL_DOCUMENT_ID}`));
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
