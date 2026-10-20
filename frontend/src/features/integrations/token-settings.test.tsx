import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationTokensSettings } from "./IntegrationTokensSettings";

const fixture = vi.hoisted(() => ({
  state: { sessionGeneration: 1, user: { id: "user", tenant_id: null, current_workspace_id: "workspace-one" }, workspace: { id: "workspace-one", name: "One", role: "owner" } },
  request: vi.fn(),
}));
vi.mock("zustand", () => ({ useStore: (_store: unknown, selector: (state: unknown) => unknown) => selector(fixture.state) }));
vi.mock("../../shared/auth/use-auth-request", () => ({
  useAuthRequest: () => ({ accessToken: "jwt", workspaceId: fixture.state.workspace.id }),
  authRequestOptions: (auth: { accessToken: string; workspaceId: string }) => ({ token: auth.accessToken, workspaceId: auth.workspaceId }),
}));
vi.mock("../../shared/api/api-client", async importOriginal => ({...await importOriginal<typeof import("../../shared/api/api-client")>(),apiRequest:fixture.request}));
const token = { id: "token", name: "Agent", permissions: ["documents:read"], secret_prefix: "orbis_it_prefix", collection_id: null, document_id: null,version:1, expires_at_ms: Date.now() + 86400000, revoked_at_ms: null, last_used_at_ms: null };
beforeEach(() => {
  fixture.state = { sessionGeneration: 1, user: { id: "user", tenant_id: null, current_workspace_id: "workspace-one" }, workspace: { id: "workspace-one", name: "One", role: "owner" } };
  fixture.request.mockReset();
  fixture.request.mockImplementation(async (_path: string, options: { method?: string } = {}) => options.method === "POST" ? { credential:token, token: "orbis_it_once_only_secret" } : { items: [],pagination:{page:1,page_size:20,total:0} });
});
afterEach(() => vi.clearAllMocks());

describe("integration token settings", () => {
  it("only shows a generated secret once and clears it synchronously on workspace change", async () => {
    const view = render(<IntegrationTokensSettings />);
    fireEvent.change(screen.getByLabelText("令牌名称"), { target: { value: "Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "生成集成令牌" }));
    expect(await screen.findByLabelText("新集成令牌")).toHaveValue("orbis_it_once_only_secret");
    fixture.state = { ...fixture.state, user: { ...fixture.state.user, current_workspace_id: "workspace-two" }, workspace: { ...fixture.state.workspace, id: "workspace-two", name: "Two" } };
    view.rerender(<IntegrationTokensSettings />);
    expect(screen.queryByLabelText("新集成令牌")).not.toBeInTheDocument();
    await waitFor(() => expect(fixture.request).toHaveBeenLastCalledWith("/v1/workspaces/workspace-two/integration-tokens?page=1&page_size=20", expect.objectContaining({ workspaceId: "workspace-two" })));
  });
  it("does not display a late secret from a previous workspace request", async () => {
    let finish!: (value: unknown) => void;
    fixture.request.mockImplementation((_path: string, options: { method?: string } = {}) => options.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ items: [],pagination:{page:1,page_size:20,total:0} }));
    const view = render(<IntegrationTokensSettings />);
    fireEvent.change(screen.getByLabelText("令牌名称"), { target: { value: "Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "生成集成令牌" }));
    fixture.state = { ...fixture.state, sessionGeneration: 2, workspace: { ...fixture.state.workspace, id: "workspace-two" } };
    view.rerender(<IntegrationTokensSettings />);
    await act(async () => { finish({ credential:token, token: "orbis_it_previous_secret" }); });
    expect(screen.queryByLabelText("新集成令牌")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成集成令牌" })).toBeInTheDocument();
  });
});

it("retains the one-time secret when creation returns from a later list page",async()=>{
  fixture.request.mockImplementation(async(path:string,options:{method?:string}={})=>options.method==="POST"?{credential:token,token:"orbis_it_new_page_secret"}:{items:[],pagination:{page:path.includes("page=2")?2:1,page_size:20,total:21}});
  render(<IntegrationTokensSettings/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"下一页令牌"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"下一页令牌"}));
  await waitFor(()=>expect(fixture.request).toHaveBeenCalledWith(expect.stringContaining("page=2"),expect.anything()));
  fireEvent.change(screen.getByLabelText("令牌名称"),{target:{value:"Agent"}});
  fireEvent.click(screen.getByRole("button",{name:"生成集成令牌"}));
  expect(await screen.findByLabelText("新集成令牌")).toHaveValue("orbis_it_new_page_secret");
  await waitFor(()=>expect(fixture.request).toHaveBeenLastCalledWith(expect.stringContaining("page=1"),expect.anything()));
  expect(screen.getByLabelText("新集成令牌")).toHaveValue("orbis_it_new_page_secret");
});
