import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSession } from "./session";
import { readJournal, writeJournal, type PendingOperation } from "./journal";
import { makeElement, type Board, type Change, type Mutation } from "./model";
import { ApiError } from "../../shared/api/api-client";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  receipt: vi.fn(),
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
  mock.receipt.mockRejectedValue(
    new ApiError(404, "Missing", "RESOURCE_NOT_FOUND"),
  );
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
});
function session(key = crypto.randomUUID()) {
  const s = new BoardSession(metadata.id, key, auth);
  sessions.push(s);
  return { s, key };
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
describe("board durable save", () => {
  it("ignores empty commands before persistence and preserves valid commands in the same submission", async () => {
    const { s, key } = session();
    await s.start();
    await s.submit([]);
    await s.submit([{ type: "elements.update", patches: [] }]);
    await s.submit([{ type: "elements.create", elements: [] }, { type: "elements.delete", targets: [] }]);
    expect(mock.change).not.toHaveBeenCalled();
    expect(await readJournal(key)).toEqual([]);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0, canUndo: false });

    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockImplementation(async (_id, input) => ack(input));
    await s.submit([{ type: "elements.update", patches: [] }, { type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().pending).toBe(0));
    expect(mock.change.mock.calls[0][1].commands).toEqual([{ type: "elements.create", elements: [e] }]);
    expect(s.getSnapshot().elements.has(e.id)).toBe(true);
  });

  it("removes legacy empty operations without rewriting a nonempty operation's payload or ID", async () => {
    const { s, key } = session();
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    const empty: PendingOperation = {
      input: { operation_id: crypto.randomUUID(), schema_version: 1, commands: [{ type: "elements.update", patches: [] }] },
      before: [], before_pages: metadata.pages, page_id: metadata.pages[0].id, history_mode: "normal",
    };
    const real = { ...empty, input: { ...empty.input, operation_id: crypto.randomUUID(), commands: [{ type: "elements.create" as const, elements: [e] }, { type: "elements.update" as const, patches: [] }] } };
    await writeJournal(key, [empty, real], []);
    mock.change.mockRejectedValue(new ApiError(422, "Rejected", "VALIDATION_ERROR"));
    await s.start();
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    expect(mock.change).toHaveBeenCalledTimes(1);
    expect(mock.change.mock.calls[0][1]).toEqual(real.input);
    expect((await readJournal(key)).map(p => p.input)).toEqual([real.input]);
    await expect(s.discardPending()).rejects.toThrow("尚未确认");
  });

  it("opens a board normally when its legacy journal only contains an empty operation", async () => {
    const { s, key } = session();
    await writeJournal(key, [{
      input: { operation_id: crypto.randomUUID(), schema_version: 1, commands: [{ type: "elements.update", patches: [] }] },
      before: [], before_pages: metadata.pages, page_id: metadata.pages[0].id, history_mode: "normal",
    }], []);
    await s.start();
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0, error: null });
    expect(mock.change).not.toHaveBeenCalled();
    expect(await readJournal(key)).toEqual([]);
  });

  it("preserves a definitive rejection and the backend validation reason across reopening", async () => {
    const { s, key } = session();
    await s.start();
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValue(new ApiError(422, "请求字段校验失败", "VALIDATION_ERROR", "request-1", {
      errors: [{ field: "body", code: "INVALID_VALUE", message: "图元尺寸无效" }],
    }));
    await s.submit([{ type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    expect(s.getSnapshot().error).toContain("图元尺寸无效");
    expect(console.error).toHaveBeenCalledWith("画板操作同步失败", expect.objectContaining({
      board_id: metadata.id, stage: "request", exception_type: "ApiError", status: 422,
      code: "VALIDATION_ERROR", request_id: "request-1", reason: expect.stringContaining("图元尺寸无效"),
      validation_errors: [{ field: "body", message: "图元尺寸无效" }],
    }));
    expect(s.getSnapshot()).toMatchObject({ canDiscard: true });
    s.dispose();
    mock.change.mockClear();
    const reopened = session(key).s;
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ status: "conflict", canDiscard: true });
    expect(reopened.getSnapshot().error).toContain("图元尺寸无效");
    expect(mock.change).not.toHaveBeenCalled();
    await reopened.discardPending();
    expect(await readJournal(key)).toEqual([]);
  });

  it("persists uncertainty before retrying a rejected operation so a lost retry cannot be discarded after reopening", async () => {
    const { s, key } = session();
    await s.start();
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValueOnce(new ApiError(422, "Invalid", "VALIDATION_ERROR"));
    await s.submit([{ type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    mock.change.mockImplementationOnce(async () => {
      expect((await readJournal(key))[0]).toMatchObject({ delivery: "unconfirmed" });
      throw new TypeError("response lost");
    });
    await s.retry();
    expect(s.getSnapshot()).toMatchObject({ status: "offline", canDiscard: false });
    s.dispose();
    mock.change.mockRejectedValue(new ApiError(403, "Forbidden", "FORBIDDEN"));
    const reopened = session(key).s;
    await reopened.start();
    await vi.waitFor(() => expect(reopened.getSnapshot().status).toBe("conflict"));
    await expect(reopened.discardPending()).rejects.toThrow("尚未确认");
  });

  it("replays the same operation after a committed response is lost, including after reopening", async () => {
    const { s, key } = session();
    await s.start();
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    let committed: Change | undefined;
    mock.change.mockImplementationOnce(async (_id, input) => {
      committed = ack(input);
      throw new TypeError("response lost");
    });
    await s.submit([{ type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("offline"));
    const pending = await readJournal(key);
    expect(pending).toHaveLength(1);
    await expect(s.discardPending()).rejects.toThrow("尚未确认");
    s.dispose();
    metadata.revision = 2;
    mock.receipt.mockImplementation(async () => committed);
    mock.elements.mockResolvedValue({
      items: committed!.elements,
      revision: 2,
      next_cursor: null,
      has_more: false,
    });
    mock.change.mockImplementation(async (_id, input) => {
      expect(input.operation_id).toBe(pending[0].input.operation_id);
      return committed;
    });
    const reopened = session(key).s;
    await reopened.start();
    await vi.waitFor(() => expect(reopened.getSnapshot().status).toBe("saved"));
    expect(reopened.getSnapshot().elements.size).toBe(1);
    expect(await readJournal(key)).toEqual([]);
  });
  it("retains a rejected local draft if refreshing the server fails during discard", async () => {
    const { s, key } = session();
    await s.start();
    mock.change.mockRejectedValue(
      new ApiError(409, "Conflict", "BOARD_ELEMENT_CONFLICT"),
    );
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    await s.submit([{ type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    mock.get.mockRejectedValueOnce(new TypeError("offline"));
    await expect(s.discardPending()).rejects.toThrow("offline");
    expect(await readJournal(key)).toHaveLength(1);
    expect(s.getSnapshot().elements.get(e.id)?.text).toBe(e.text);
    expect(s.getSnapshot()).toMatchObject({ status: "conflict", error: "Conflict", canDiscard: true });
  });
  it.each([403, 409])("retains an uncertain operation after a retry receives HTTP %s", async (status) => {
    const { s, key } = session();
    await s.start();
    const e = makeElement("flow.process", metadata.pages[0].id, 0, 0);
    mock.change.mockRejectedValueOnce(new TypeError("response lost"));
    await s.submit([{ type: "elements.create", elements: [e] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("offline"));
    const pending = await readJournal(key);
    mock.change.mockRejectedValueOnce(new ApiError(status, "Retry rejected", "BOARD_ACCESS_CHANGED"));
    await s.retry();
    await expect(s.discardPending()).rejects.toThrow("尚未确认");
    expect(await readJournal(key)).toEqual(pending);

    mock.change.mockImplementationOnce(async (_id, input) => {
      expect(input.operation_id).toBe(pending[0].input.operation_id);
      return ack(input);
    });
    await s.retry();
    expect(s.getSnapshot().status).toBe("saved");
    expect(await readJournal(key)).toEqual([]);
  });
  it("keeps a recovered operation uncertain when replay is rejected", async () => {
    const { s, key } = session();
    await s.start();
    mock.change.mockRejectedValueOnce(new TypeError("response lost"));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("offline"));
    s.dispose();
    mock.change.mockRejectedValue(new ApiError(403, "Permission changed", "FORBIDDEN"));
    const reopened = session(key).s;
    await reopened.start();
    await vi.waitFor(() => expect(reopened.getSnapshot().status).toBe("conflict"));
    await expect(reopened.discardPending()).rejects.toThrow("尚未确认");
    expect(await readJournal(key)).toHaveLength(1);
  });
  it("allows discarding an operation definitively rejected on its first attempt", async () => {
    const { s, key } = session();
    await s.start();
    mock.change.mockRejectedValue(new ApiError(409, "Conflict", "BOARD_ELEMENT_CONFLICT"));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    await s.discardPending();
    expect(await readJournal(key)).toEqual([]);
  });
  it("does not resend a rejected operation while discarding it and reloading the server", async () => {
    const { s, key } = session();
    await s.start();
    mock.change.mockRejectedValue(new ApiError(409, "Conflict", "BOARD_ELEMENT_CONFLICT"));
    await s.submit([{ type: "elements.create", elements: [makeElement("flow.process", metadata.pages[0].id, 0, 0)] }]);
    await vi.waitFor(() => expect(s.getSnapshot().canDiscard).toBe(true));
    let reload!: (board: Board) => void;
    mock.get.mockImplementationOnce(() => new Promise<Board>(resolve => { reload = resolve; }));
    const discard = s.discardPending();
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("loading"));
    await s.retry();
    expect(mock.change).toHaveBeenCalledTimes(1);
    reload(metadata);
    await discard;
    expect(await readJournal(key)).toEqual([]);
    expect(s.getSnapshot()).toMatchObject({ status: "saved", pending: 0, canDiscard: false });
  });
  it("does not apply a response from a disposed session after StrictMode restarts it", async () => {
    const { s } = session();
    let resolve!: (value: Board) => void;
    mock.get.mockImplementationOnce(
      () =>
        new Promise<Board>((r) => {
          resolve = r;
        }),
    );
    const first = s.start();
    await vi.waitFor(() => expect(mock.get).toHaveBeenCalledOnce());
    s.dispose();
    const second = s.start();
    await second;
    resolve({ ...metadata, title: "stale lifecycle" });
    await first;
    expect(s.getSnapshot().board?.title).toBe("Test");
  });
});

it("never overwrites another window's durable pending operations", async () => {
  const { writeJournal } = await import("./journal");
  const key = crypto.randomUUID();
  const input: Mutation = {
    operation_id: crypto.randomUUID(),
    schema_version: 1,
    commands: [],
  };
  const first = {
    input,
    before: [],
    before_pages: [],
    page_id: crypto.randomUUID(),
    history_mode: "normal" as const,
  };
  await writeJournal(key, [first], []);
  await expect(writeJournal(key, [], [])).rejects.toThrow("另一个窗口");
  expect((await readJournal(key))[0].input.operation_id).toBe(
    input.operation_id,
  );
  await writeJournal(key, [], [first]);
});

it("does not overwrite another window's delivery transition for the same operation", async () => {
  const key = crypto.randomUUID();
  const queued: PendingOperation = {
    input: { operation_id: crypto.randomUUID(), schema_version: 1, commands: [] },
    before: [], before_pages: [], page_id: crypto.randomUUID(), history_mode: "normal", delivery: "queued",
  };
  const sending = { ...queued, delivery: "unconfirmed" as const };
  await writeJournal(key, [queued], []);
  await writeJournal(key, [sending], [queued]);
  await expect(writeJournal(key, [], [queued])).rejects.toThrow("另一个窗口");
  expect(await readJournal(key)).toEqual([sending]);
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
