import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSession } from "./session";
import { makeElement, type Board, type Change, type Mutation } from "./model";
import { ApiError } from "../../shared/api/api-client";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  elements: vi.fn(),
  change: vi.fn(),
  changes: vi.fn(),
}));
vi.mock("./api", () => ({ boardAPI: () => mock }));
const auth = () => ({
  accessToken: "test",
  refreshToken: null,
  onTokenRefresh: () => {},
  onUnauthorized: () => {},
});
const sessions: BoardSession[] = [];
let metadata: Board;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const id = crypto.randomUUID();
  metadata = {
    id,
    document_id: crypto.randomUUID(),
    workspace_id: crypto.randomUUID(),
    collection_id: crypto.randomUUID(),
    title: "Test",
    schema_version: 1,
    revision: 1,
    pages: [
      {
        id: crypto.randomUUID(),
        name: "Page",
        background: "#ffffff",
        position: 0,
        version: 1,
      },
    ],
    created_at_ms: 1,
    updated_at_ms: 1,
  };
  mock.get.mockImplementation(async () => structuredClone(metadata));
  mock.elements.mockResolvedValue({
    items: [],
    revision: 1,
    next_cursor: null,
    has_more: false,
  });
  mock.changes.mockResolvedValue({ items: [], revision: 1, has_more: false });
});
afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function session() {
  const s = new BoardSession(metadata.id, auth);
  sessions.push(s);
  return { s };
}
function ack(input: Mutation): Change {
  const command = input.commands[0];
  if (command.type !== "elements.create") throw Error("expected create");
  return {
    operation_id: input.operation_id,
    revision: 2,
    elements: command.elements.map((e) => ({
      ...e,
      version: 1,
      versions: { geometry: 1, style: 1, text: 1, structure: 1 },
    })),
    deleted: [],
    pages: [],
    deleted_pages: [],
    updated_at_ms: 2,
  };
}
describe("board in-memory saving", () => {
  it("opens and saves without accessing browser storage", async () => {
    const open = vi.fn(() => { throw new Error("Storage is unavailable"); });
    vi.stubGlobal("indexedDB", { open });
    const localRead = vi.spyOn(localStorage, "getItem");
    const localWrite = vi.spyOn(localStorage, "setItem");
    const { s } = session();
    await s.start();
    mock.change.mockImplementation(async (_id, input) => ack(input));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0 }));
    expect(open).not.toHaveBeenCalled();
    expect(localRead).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("does not notify the editor during idle polling", async () => {
    const { s } = session();
    await s.start();
    const listener = vi.fn();
    s.subscribe(listener);
    await vi.waitFor(() => expect(mock.changes).toHaveBeenCalled(), { timeout: 1500 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores empty commands and submits valid commands once", async () => {
    const { s } = session();
    await s.start();
    await s.submit([]);
    await s.submit([{ type: "elements.update", patches: [] }, { type: "elements.delete", targets: [] }]);
    expect(mock.change).not.toHaveBeenCalled();
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0, canUndo: false });
    const element = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockImplementation(async (_id, input) => ack(input));
    await s.submit([{ type: "elements.update", patches: [] }, { type: "elements.create", elements: [element] }]);
    await vi.waitFor(() => expect(s.getSnapshot().pending).toBe(0));
    expect(mock.change.mock.calls[0][1].commands).toEqual([{ type: "elements.create", elements: [element] }]);
  });

  it("retains a failed edit in memory and only resends after an explicit retry", async () => {
    vi.useFakeTimers();
    const { s } = session();
    await s.start();
    const element = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValue(new TypeError("Network unavailable"));
    await s.submit([{ type: "elements.create", elements: [element] }]);
    await vi.waitFor(() => expect(s.getSnapshot()).toMatchObject({ status: "save_failed", pending: 1 }));
    expect(s.getSnapshot().elements.has(element.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mock.change).toHaveBeenCalledOnce();
    await expect(s.submit([{ type: "elements.create", elements: [element] }])).rejects.toThrow("请先重试保存");
    const original = structuredClone(mock.change.mock.calls[0][1]);
    mock.change.mockImplementation(async (_id, input) => ack(input));
    await s.retry();
    expect(mock.change.mock.calls[1][1]).toEqual(original);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0 });
  });

  it("preserves request order when another edit is submitted before the first acknowledgement", async () => {
    const { s } = session();
    await s.start();
    let finish!: (change: Change) => void;
    mock.change.mockImplementationOnce(() => new Promise<Change>(resolve => { finish = resolve; }));
    mock.change.mockImplementation(async (_id, input) => ack(input));
    const first = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    const second = makeElement("flow.process", metadata.pages[0].id, 300, 0);
    await s.submit([{ type: "elements.create", elements: [first] }]);
    await s.submit([{ type: "elements.create", elements: [second] }]);
    expect(mock.change).toHaveBeenCalledOnce();
    expect(s.getSnapshot().pending).toBe(2);
    finish(ack(mock.change.mock.calls[0][1]));
    await vi.waitFor(() => expect(s.getSnapshot().pending).toBe(0));
    expect(mock.change).toHaveBeenCalledTimes(2);
    expect(s.getSnapshot().elements.size).toBe(2);
  });

  it.each(["before", "after"])("keeps another editor independent when opened %s a failed save on the same board", async when => {
    const { s } = session();
    const second = session().s;
    await s.start();
    if (when === "before") await second.start();
    const firstElement = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValueOnce(new TypeError("Disconnected"));
    await s.submit([{ type: "elements.create", elements: [firstElement] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("save_failed"));
    const firstRequest = structuredClone(mock.change.mock.calls[0][1]);
    if (when === "after") await second.start();
    expect(second.getSnapshot().pending).toBe(0);
    expect(mock.change).toHaveBeenCalledOnce();
    mock.change.mockImplementation(async (_id, input) => ack(input));
    const secondElement = makeElement("flow.process", metadata.pages[0].id, 300, 0);
    await second.submit([{ type: "elements.create", elements: [secondElement] }]);
    await vi.waitFor(() => expect(second.getSnapshot()).toMatchObject({ status: "saved", pending: 0 }));
    expect(s.getSnapshot()).toMatchObject({ status: "save_failed", pending: 1 });
    expect(mock.change.mock.calls[1][1].operation_id).not.toBe(firstRequest.operation_id);
    await s.retry();
    expect(mock.change.mock.calls[2][1]).toEqual(firstRequest);
    expect(s.getSnapshot().pending).toBe(0);
  });

  it("opens server content without restoring or replaying an unsaved edit after disposal", async () => {
    const { s } = session();
    await s.start();
    const element = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValue(new TypeError("Offline"));
    await s.submit([{ type: "elements.create", elements: [element] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("save_failed"));
    s.dispose();
    mock.change.mockClear();
    const reopened = session().s;
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ status: "saved", pending: 0 });
    expect(reopened.getSnapshot().elements.size).toBe(0);
    expect(mock.change).not.toHaveBeenCalled();
  });

  it("retries an ambiguous save with its original operation ID and payload", async () => {
    const { s } = session();
    await s.start();
    let committed!: Change;
    mock.change.mockImplementationOnce(async (_id, input) => { committed = ack(input); throw new TypeError("Response lost"); });
    const element = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    await s.submit([{ type: "elements.create", elements: [element] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("save_failed"));
    await expect(s.discardPending()).rejects.toThrow("尚未确认");
    mock.change.mockResolvedValueOnce(committed);
    await s.retry();
    expect(mock.change.mock.calls[1][1]).toEqual(mock.change.mock.calls[0][1]);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0 });
    expect(s.getSnapshot().elements.size).toBe(1);
  });

  it.each([403, 409])("retains an uncertain operation if its retry receives HTTP %s", async status => {
    const { s } = session();
    await s.start();
    mock.change.mockRejectedValueOnce(new TypeError("Response lost"));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("save_failed"));
    mock.change.mockRejectedValueOnce(new ApiError(status, "Retry rejected", "BOARD_ACCESS_CHANGED"));
    await s.retry();
    expect(s.getSnapshot()).toMatchObject({ pending: 1, canDiscard: false });
    await expect(s.discardPending()).rejects.toThrow("尚未确认");
    mock.change.mockImplementationOnce(async (_id, input) => ack(input));
    await s.retry();
    expect(s.getSnapshot().pending).toBe(0);
  });

  it("preserves diagnostic details and retains a rejected edit if discarding cannot reload the server", async () => {
    const { s } = session();
    await s.start();
    mock.change.mockRejectedValue(new ApiError(422, "请求字段校验失败", "VALIDATION_ERROR", "request-1", {
      errors: [{ field: "body", code: "INVALID_VALUE", message: "图元尺寸无效" }],
    }));
    const element = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    await s.submit([{ type: "elements.create", elements: [element] }]);
    await vi.waitFor(() => expect(s.getSnapshot().canDiscard).toBe(true));
    expect(console.error).toHaveBeenCalledWith("画板操作同步失败", expect.objectContaining({
      board_id: metadata.id, stage: "request", exception_type: "ApiError", status: 422,
      code: "VALIDATION_ERROR", request_id: "request-1", reason: expect.stringContaining("图元尺寸无效"),
    }));
    mock.get.mockRejectedValueOnce(new Error("Read failed"));
    await expect(s.discardPending()).rejects.toThrow("Read failed");
    expect(s.getSnapshot()).toMatchObject({ status: "conflict", pending: 1, canDiscard: true });
    expect(s.getSnapshot().elements.has(element.id)).toBe(true);
    await s.discardPending();
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0 });
    expect(s.getSnapshot().elements.size).toBe(0);
  });

  it("does not resend a rejected operation while reloading the server to discard it", async () => {
    const { s } = session();
    await s.start();
    mock.change.mockRejectedValue(new ApiError(409, "Conflict", "BOARD_ELEMENT_CONFLICT"));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot().canDiscard).toBe(true));
    let reload!: (board: Board) => void;
    mock.get.mockImplementationOnce(() => new Promise<Board>(resolve => { reload = resolve; }));
    const discard = s.discardPending();
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("loading"));
    await s.retry();
    expect(mock.change).toHaveBeenCalledOnce();
    reload(metadata);
    await discard;
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0 });
  });

  it("ignores an old response when StrictMode restarts a disposed session", async () => {
    const { s } = session();
    let resolve!: (value: Board) => void;
    mock.get.mockImplementationOnce(() => new Promise<Board>(done => { resolve = done; }));
    const first = s.start();
    s.dispose();
    await s.start();
    resolve({ ...metadata, title: "Stale lifecycle" });
    await first;
    expect(s.getSnapshot().board?.title).toBe("Test");
  });
});

it("does not apply a local mutation twice when the stream arrives before its HTTP receipt", async () => {
  const { s } = session();
  await s.start();
  let resolve!: (value: Change) => void, saved!: Change;
  mock.change.mockImplementationOnce(async (_id, input) => {
    saved = ack(input);
    return new Promise<Change>((r) => {
      resolve = r;
    });
  });
  const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
  await s.submit([{ type: "elements.create", elements: [e] }]);
  await vi.waitFor(() => expect(mock.change).toHaveBeenCalledOnce());
  mock.changes.mockResolvedValue({
    items: [saved],
    revision: 2,
    has_more: false,
  });
  await vi.waitFor(() => expect(mock.changes).toHaveBeenCalled(), {
    timeout: 2000,
  });
  expect(s.getSnapshot().elements.get(e.id)?.versions.geometry).toBe(1);
  expect(s.getSnapshot().pending).toBe(1);
  resolve(saved);
  await vi.waitFor(() => expect(s.getSnapshot().pending).toBe(0));
});

function historyBackend(initial: ReturnType<typeof makeElement>[] = []) {
  const elements = new Map(
    initial.map((element) => [element.id, structuredClone(element)]),
  );
  const deleted = new Map<string, ReturnType<typeof makeElement>>();
  const deletedPages = new Map<string, Board["pages"][number]>();
  const groups = ["geometry", "style", "text", "structure"] as const;
  const conflict = () => {
    throw new ApiError(409, "Conflict", "BOARD_ELEMENT_CONFLICT");
  };
  mock.elements.mockImplementation(async (_id, pageID) => ({
    items: structuredClone(
      [...elements.values()].filter((element) => element.page_id === pageID),
    ),
    revision: metadata.revision,
    next_cursor: null,
    has_more: false,
  }));
  mock.change.mockImplementation(async (_id, input: Mutation) => {
    const change: Change = {
      operation_id: input.operation_id,
      revision: ++metadata.revision,
      elements: [],
      deleted: [],
      pages: [],
      deleted_pages: [],
      updated_at_ms: metadata.revision,
    };
    for (const command of input.commands) {
      if (command.type === "elements.create") {
        for (const item of command.elements) {
          const element = {
            ...structuredClone(item),
            version: 1,
            versions: { geometry: 1, style: 1, text: 1, structure: 1 },
          };
          elements.set(element.id, element);
          change.elements.push(element);
        }
      } else if (
        command.type === "elements.update" ||
        command.type === "layout.apply"
      ) {
        for (const patch of command.patches) {
          const element = structuredClone(elements.get(patch.id)!);
          for (const group of groups)
            if (patch[group] !== undefined) {
              if (element.versions[group] !== patch.expected[group]) conflict();
              Object.assign(element, { [group]: patch[group] });
              element.versions[group]++;
            }
          element.version++;
          elements.set(element.id, element);
          change.elements.push(element);
        }
      } else if (
        command.type === "elements.delete" ||
        command.type === "elements.restore"
      ) {
        for (const target of command.targets) {
          const restore = command.type === "elements.restore";
          const element = structuredClone(
            (restore ? deleted : elements).get(target.id)!,
          );
          if (element.version !== target.version) conflict();
          if (restore) {
            element.version++;
            for (const group of groups) element.versions[group]++;
            elements.set(element.id, element);
            change.elements.push(element);
          } else {
            deleted.set(element.id, element);
            elements.delete(element.id);
            change.deleted.push(element.id);
          }
        }
      } else if ("page" in command) {
        const current =
          command.type === "pages.restore"
            ? deletedPages.get(command.page.id)
            : metadata.pages.find((page) => page.id === command.page.id);
        if (
          command.type !== "pages.create" &&
          current?.version !== command.page.version
        )
          conflict();
        metadata.pages = metadata.pages.filter(
          (page) => page.id !== command.page.id,
        );
        if (command.type === "pages.delete") {
          deletedPages.set(command.page.id, structuredClone(current!));
          change.deleted_pages.push(command.page.id);
        } else {
          const page = {
            ...structuredClone(command.page),
            version:
              command.type === "pages.create" ? 1 : command.page.version + 1,
          };
          metadata.pages.push(page);
          change.pages.push(page);
        }
      }
    }
    return structuredClone(change);
  });
  return elements;
}
async function saved(s: BoardSession) {
  await vi.waitFor(() => expect(s.getSnapshot().status).toBe("saved"));
}
async function move(s: BoardSession, x: number) {
  const element = [...s.getSnapshot().elements.values()][0];
  await s.submit([
    {
      type: "elements.update",
      patches: [
        {
          id: element.id,
          expected: element.versions,
          geometry: { ...element.geometry, x },
        },
      ],
    },
  ]);
  await saved(s);
}
async function create(s: BoardSession) {
  await s.submit([
    {
      type: "elements.create",
      elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)],
    },
  ]);
  await saved(s);
}

describe("board history", () => {
  it("loads the affected page before cross-page undo and redo", async () => {
    historyBackend();
    metadata.pages.push({
      ...metadata.pages[0],
      id: crypto.randomUUID(),
      name: "Second",
      position: 1,
    });
    const { s } = session();
    await s.start();
    await create(s);
    await move(s, 20);
    const first = s.getSnapshot().pageID;
    await s.switchPage(metadata.pages[1].id);
    await s.undo();
    await saved(s);
    expect(s.getSnapshot().pageID).toBe(first);
    expect([...s.getSnapshot().elements.values()][0].geometry.x).toBe(0);
    await s.redo();
    await saved(s);
    expect(s.getSnapshot().elements.size).toBe(1);
    expect([...s.getSnapshot().elements.values()][0].geometry.x).toBe(20);
  });

  it("undoes and redoes consecutive moves and creation using acknowledged versions", async () => {
    historyBackend();
    const { s } = session();
    await s.start();
    await create(s);
    await move(s, 10);
    await move(s, 20);
    for (const x of [10, 0]) {
      await s.undo();
      await saved(s);
      expect([...s.getSnapshot().elements.values()][0].geometry.x).toBe(x);
    }
    await s.undo();
    await saved(s);
    expect(s.getSnapshot().elements.size).toBe(0);
    for (const x of [0, 10, 20]) {
      await s.redo();
      await saved(s);
      expect([...s.getSnapshot().elements.values()][0].geometry.x).toBe(x);
    }
  });

  it("keeps earlier edits usable after restoring a deleted element", async () => {
    historyBackend();
    const { s } = session();
    await s.start();
    await create(s);
    await move(s, 10);
    const element = [...s.getSnapshot().elements.values()][0];
    await s.submit([
      {
        type: "elements.delete",
        targets: [{ id: element.id, version: element.version }],
      },
    ]);
    await saved(s);
    await s.undo();
    await saved(s);
    await s.undo();
    await saved(s);
    expect([...s.getSnapshot().elements.values()][0].geometry.x).toBe(0);
    await s.redo();
    await saved(s);
    await s.redo();
    await saved(s);
    expect(s.getSnapshot().elements.size).toBe(0);
  });

  it("rebases page history after updates and restoration", async () => {
    historyBackend();
    metadata.pages.push({
      ...metadata.pages[0],
      id: crypto.randomUUID(),
      name: "Second",
      position: 1,
    });
    const { s } = session();
    await s.start();
    const second = metadata.pages[1].id;
    const page = () =>
      s.getSnapshot().board!.pages.find((value) => value.id === second)!;
    for (const name of ["Renamed", "Renamed again"]) {
      await s.submit([{ type: "pages.update", page: { ...page(), name } }]);
      await saved(s);
    }
    await s.submit([{ type: "pages.delete", page: page() }]);
    await saved(s);
    for (const name of ["Renamed again", "Renamed", "Second"]) {
      await s.undo();
      await saved(s);
      expect(page().name).toBe(name);
    }
    for (const name of ["Renamed", "Renamed again"]) {
      await s.redo();
      await saved(s);
      expect(page().name).toBe(name);
    }
    await s.redo();
    await saved(s);
    expect(page()).toBeUndefined();
  });

  it("does not rebase across an intervening collaborator edit to the same property", async () => {
    const elements = historyBackend();
    const { s } = session();
    await s.start();
    await create(s);
    await move(s, 10);
    const element = [...elements.values()][0];
    element.geometry.x = 30;
    element.versions.geometry++;
    element.version++;
    await s.loadPage(s.getSnapshot().pageID);
    await move(s, 40);
    await s.undo();
    await saved(s);
    await s.undo();
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    expect(elements.get(element.id)!.geometry.x).toBe(30);
  });

  it("does not let undoing creation delete an unrelated collaborator edit", async () => {
    const elements = historyBackend();
    const { s } = session();
    await s.start();
    await create(s);
    await move(s, 10);
    const element = [...elements.values()][0];
    element.style.fill = "#ff0000";
    element.versions.style++;
    element.version++;
    await s.loadPage(s.getSnapshot().pageID);
    await s.undo();
    await saved(s);
    await s.undo();
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    expect(elements.get(element.id)!.style.fill).toBe("#ff0000");
  });
});
