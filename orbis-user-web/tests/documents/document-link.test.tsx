import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentLink, DOCUMENT_PREFETCH_DWELL_MS } from "../../src/features/documents/DocumentLink";
import { authStore } from "../../src/shared/auth/auth-store";

const mock = vi.hoisted(() => ({ note: vi.fn(), content: vi.fn(), module: vi.fn() }));
vi.mock("../../src/features/documents/api", () => ({ getNote: mock.note, getNoteContentPage: mock.content }));
vi.mock("../../src/features/documents/editor-module", () => ({ loadDocumentEditor: mock.module }));
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); authStore.getState().clearSession(); });

it("prefetches only the intended document while retaining native link attributes", async () => {
  vi.useFakeTimers();
  authStore.setState({ accessToken: "local", refreshToken: null });
  mock.note.mockResolvedValue({ id: "target" });
  mock.content.mockResolvedValue({ note_id: "target" });
  mock.module.mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><DocumentLink noteId="target" to="/documents/target" target="_blank">Target</DocumentLink><DocumentLink noteId="other" to="/documents/other">Other</DocumentLink></MemoryRouter></QueryClientProvider>);
  expect(mock.note).not.toHaveBeenCalled();
  const link = screen.getByRole("link", { name: "Target" });
  expect(link).toHaveAttribute("href", "/documents/target");
  expect(link).toHaveAttribute("target", "_blank");
  fireEvent.pointerEnter(link);
  await act(async () => { await vi.advanceTimersByTimeAsync(DOCUMENT_PREFETCH_DWELL_MS - 1); });
  expect(mock.note).not.toHaveBeenCalled();
  fireEvent.pointerLeave(link);
  await act(async () => { await vi.advanceTimersByTimeAsync(DOCUMENT_PREFETCH_DWELL_MS); });
  expect(mock.note).not.toHaveBeenCalled();
  fireEvent.pointerEnter(link);
  await act(async () => { await vi.advanceTimersByTimeAsync(DOCUMENT_PREFETCH_DWELL_MS); });
  expect(client.getQueryData(["note-content-pages", "target"])).toEqual({ note_id: "target" });
  fireEvent.focus(link);
  expect(mock.note).toHaveBeenCalledOnce();
  expect(mock.content).toHaveBeenCalledOnce();
  expect(mock.note).toHaveBeenCalledWith("target", expect.objectContaining({ accessToken: "local" }), expect.any(AbortSignal));
  expect(client.getQueryData(["note", "other"])).toBeUndefined();
});

it("keeps links usable without requesting private content when there is no session", () => {
  authStore.getState().clearSession();
  render(<MemoryRouter><DocumentLink noteId="target" to="/documents/target">Target</DocumentLink></MemoryRouter>);
  fireEvent.focus(screen.getByRole("link", { name: "Target" }));
  expect(mock.note).not.toHaveBeenCalled();
  expect(mock.module).not.toHaveBeenCalled();
});

it("does not refetch the active document from row hover or focus", async () => {
  vi.useFakeTimers();
  authStore.setState({ accessToken: "local", refreshToken: null });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 0 } } });
  const saved = { note_id: "target", content_version: 1 };
  client.setQueryData(["note-content-pages", "target"], saved);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/documents/target?comment=example"]}>
    <DocumentLink noteId="target" to="/documents/target">Current</DocumentLink>
  </MemoryRouter></QueryClientProvider>);
  const link = screen.getByRole("link", { name: "Current" });
  fireEvent.pointerEnter(link);
  await act(async () => { await vi.advanceTimersByTimeAsync(DOCUMENT_PREFETCH_DWELL_MS); });
  fireEvent.focus(link);
  expect(mock.note).not.toHaveBeenCalled();
  expect(mock.content).not.toHaveBeenCalled();
  expect(client.getQueryData(["note-content-pages", "target"])).toBe(saved);
});
