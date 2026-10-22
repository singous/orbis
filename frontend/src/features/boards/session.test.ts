import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSession } from "./session";
import { readJournal } from "./journal";
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
