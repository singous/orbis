import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserRequest } from "../sites/browser-request";
import { BoardNavigationGuard } from "../../src/features/boards/BoardNavigationGuard";
import { boardNavigation, registerBoardNavigation } from "../../src/features/boards/navigation";
import type { SessionState } from "../../src/features/boards/session";

const routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => { vi.stubGlobal("Request", BrowserRequest); });
afterEach(() => { cleanup(); routers.forEach(router => router.dispose()); routers.length = 0; vi.unstubAllGlobals(); });
function saveSession(pending = 1) {
  let state = { pending } as SessionState;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(pending: number) { state = { pending } as SessionState; for (const listener of listeners) listener(); },
  };
}
function show(...sessions: ReturnType<typeof saveSession>[]) {
  function BoardPage() {
    const navigate = useNavigate();
    useEffect(() => {
      const cleanup = sessions.map(registerBoardNavigation);
      return () => cleanup.forEach(dispose => dispose());
    }, []);
    return <><p>画板编辑页</p><Link to="/source">源画板</Link><button onClick={() => navigate('/source')}>程序跳转</button></>;
  }
  const router = createMemoryRouter([{ element: <><BoardNavigationGuard /><Outlet /></>, children: [
    { path: '/board', element: <BoardPage /> }, { path: '/source', element: <h1>源画板页</h1> },
  ] }], { initialEntries: ['/source', '/board'] });
  routers.push(router);
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

it("keeps unsaved edits when cancelling a plain Link navigation and proceeds only after explicit discard", async () => {
  const user = userEvent.setup();
  const { router } = show(saveSession());
  await user.click(await screen.findByRole('link', { name: '源画板' }));
  expect(screen.getByRole('dialog', { name: '画板尚未保存' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/board');
  await user.click(screen.getByRole('button', { name: '留在当前页' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(boardNavigation.hasPending()).toBe(true);
  await user.click(screen.getByRole('link', { name: '源画板' }));
  await user.click(screen.getByRole('button', { name: '放弃并离开' }));
  expect(await screen.findByRole('heading', { name: '源画板页' })).toBeVisible();
  expect(boardNavigation.hasPending()).toBe(false);
});

it.each(['back', 'programmatic'])("blocks %s navigation while any one of multiple board editors has unsaved changes", async kind => {
  const user = userEvent.setup();
  const first = saveSession(), second = saveSession(0);
  const { router } = show(first, second);
  await screen.findByText('画板编辑页');
  if (kind === 'back') await act(async () => { await router.navigate(-1); });
  else await user.click(screen.getByRole('button', { name: '程序跳转' }));
  expect(await screen.findByRole('dialog', { name: '画板尚未保存' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/board');
  act(() => first.publish(0));
  expect(await screen.findByRole('heading', { name: '源画板页' })).toBeVisible();
  expect(boardNavigation.hasPending()).toBe(false);
});

it("allows normal navigation when all boards are saved", async () => {
  const user = userEvent.setup();
  show(saveSession(0), saveSession(0));
  await user.click(await screen.findByRole('link', { name: '源画板' }));
  expect(await screen.findByRole('heading', { name: '源画板页' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});
