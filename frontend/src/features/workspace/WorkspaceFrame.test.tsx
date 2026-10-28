import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider, MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserRequest } from "../../../tests/support/browser-request";
import { WorkspaceRoute } from "../../app/WorkspaceRoute";
import { WorkspaceShell } from "./WorkspaceShell";

vi.mock("./WorkspaceAccountMenu", () => ({ WorkspaceAccountMenu: () => <button>Account</button> }));

const Context = createContext("missing context");
const sidebar = { title: <h2>Notebook navigation</h2>, content: <button>Notebook directory</button> };
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Body() { return <p>{useContext(Context)}</p>; }
function TextPage() { return <WorkspaceShell sidebar={sidebar} contentLayout="document" toolbar={<button>Text action</button>}><Body /></WorkspaceShell>; }
function BoardPage() { return <WorkspaceShell sidebar={sidebar} contentLayout="document" toolbar={<button>Board action</button>}><p>Board content</p></WorkspaceShell>; }
function LoadingPage() { return <WorkspaceShell loading sidebar={{ title: <h2>Generic navigation</h2>, content: <p>Generic links</p> }}><p>Loading destination</p></WorkspaceShell>; }
function harness(client: QueryClient, page: ReactNode) {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={["/documents/first"]}><WorkspaceRoute>{page}</WorkspaceRoute></MemoryRouter></QueryClientProvider>;
}
function client() { const value = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(value); return value; }

it("retains the shell, business rail and content host across text, loading and board pages", () => {
  const query = client();
  const view = render(harness(query, <TextPage />));
  const shell = document.querySelector(".workspace-shell");
  const rail = document.querySelector(".workspace-business-rail");
  const content = document.getElementById("workspace-main-content");
  view.rerender(harness(query, <LoadingPage />));
  expect(screen.getByText("Loading destination")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notebook directory" })).toBeVisible();
  expect(screen.queryByText("Generic links")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Text action" })).not.toBeInTheDocument();
  view.rerender(harness(query, <BoardPage />));
  expect(screen.getByText("Board content")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Board action" })).toBeVisible();
  expect(document.querySelectorAll(".workspace-shell")).toHaveLength(1);
  expect(document.querySelector(".workspace-shell")).toBe(shell);
  expect(document.querySelector(".workspace-business-rail")).toBe(rail);
  expect(document.getElementById("workspace-main-content")).toBe(content);
});

it("keeps document-local context available to content mounted in the persistent frame", () => {
  render(harness(client(), <Context.Provider value="Document context"><TextPage /></Context.Provider>));
  expect(screen.getByText("Document context")).toBeInTheDocument();
  expect(screen.queryByText("missing context")).not.toBeInTheDocument();
});

it("closes a mobile drawer when navigation starts outside its link subtree", () => {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 767px)", media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }));
  let navigate!: NavigateFunction;
  function Page() { navigate = useNavigate(); const { pathname } = useLocation(); return <WorkspaceShell sidebar={sidebar}><h1>{pathname}</h1></WorkspaceShell>; }
  render(harness(client(), <Page />));
  fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
  expect(document.querySelector(".workspace-shell")).toHaveClass("main-navigation-open");
  act(() => { void navigate("/documents/second"); });
  expect(screen.getByRole("heading", { name: "/documents/second" })).toBeInTheDocument();
  expect(document.querySelector(".workspace-shell")).not.toHaveClass("main-navigation-open");
});

it("lets the parent route own chrome while reused document routes reset local UI and scroll", async () => {
  vi.stubGlobal("Request", BrowserRequest);
  function Page() {
    const [count, setCount] = useState(0);
    const { pathname } = useLocation();
    return <WorkspaceShell sidebar={sidebar} toolbar={<button>{pathname} action</button>}>
      <button onClick={() => setCount(value => value + 1)}>Local count {count}</button>
    </WorkspaceShell>;
  }
  const router = createMemoryRouter([{ element: <WorkspaceRoute />, children: [
    { path: "/documents/:noteId", element: <Page /> },
    { path: "/home", element: <WorkspaceShell sidebar={false}><h1>Home</h1></WorkspaceShell> },
  ] }], { initialEntries: ["/documents/first"] });
  const view = render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>);
  const shell = document.querySelector(".workspace-shell");
  const content = document.getElementById("workspace-main-content")!;
  const scroll = document.querySelector<HTMLElement>(".workspace-content")!;
  fireEvent.click(screen.getByRole("button", { name: "Local count 0" }));
  expect(screen.getByRole("button", { name: "Local count 1" })).toBeVisible();
  scroll.scrollTop = 200;
  await act(() => router.navigate("/documents/second"));
  expect(screen.getByRole("button", { name: "Local count 0" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "/documents/first action" })).not.toBeInTheDocument();
  expect(scroll.scrollTop).toBe(0);
  expect(document.getElementById("workspace-main-content")).toBe(content);
  await act(() => router.navigate("/home"));
  expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(document.querySelector(".workspace-shell")).toBe(shell);
  expect(screen.queryByRole("button", { name: "/documents/second action" })).not.toBeInTheDocument();
  view.unmount();
  router.dispose();
});
