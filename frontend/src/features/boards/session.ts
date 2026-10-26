import { newUUID } from "../../shared/ids";
import { connectBoard } from "./sync";
import { ApiError } from "../../shared/api/api-client";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { boardAPI } from "./api";
import { boardErrorMessage, boardValidationErrors } from "./errors";
import { readJournal, writeJournal, type PendingOperation } from "./journal";
import {
  BOARD_SCHEMA_VERSION,
  MAX_COMMAND_ELEMENTS,
  commandHasTargets,
  type Board,
  type BoardPage,
  type Change,
  type Command,
  type Element,
  type Mutation,
  type Patch,
} from "./model";

type Status = "loading" | "saved" | "saving" | "offline" | "conflict" | "error";
export type SessionState = {
  board: Board | null;
  pageID: string;
  elements: Map<string, Element>;
  status: Status;
  error: string | null;
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  canDiscard: boolean;
};
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
type History = {
  bytes: number;
  pageID: string;
  input: Mutation;
  before: Element[];
  beforePages: BoardPage[];
  change: Change;
};
function preview(
  base: Map<string, Element>,
  commands: Command[],
): Map<string, Element> {
  const next = new Map(base);
  for (const command of commands) {
    if (command.type === "elements.create")
      for (const value of command.elements)
        next.set(value.id, {
          ...value,
          version: 1,
          versions: { geometry: 1, style: 1, text: 1, structure: 1 },
        });
    if (command.type === "elements.update" || command.type === "layout.apply")
      for (const patch of command.patches) {
        const value = next.get(patch.id);
        if (!value) continue;
        const versions = { ...value.versions };
        for (const group of ["geometry", "style", "text", "structure"] as const)
          if (patch[group] !== undefined) versions[group]++;
        next.set(value.id, {
          ...value,
          ...(patch.geometry ? { geometry: patch.geometry } : {}),
          ...(patch.style ? { style: patch.style } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.structure ? { structure: patch.structure } : {}),
          version: value.version + 1,
          versions,
        });
      }
    if (command.type === "elements.delete") {
      const remove = new Set(command.targets.map((t) => t.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const [id, e] of next)
          if (
            !remove.has(id) &&
            (remove.has(e.structure.parent_id ?? "") ||
              remove.has(e.structure.start?.element_id ?? "") ||
              remove.has(e.structure.end?.element_id ?? ""))
          ) {
            remove.add(id);
            changed = true;
          }
      }
      for (const id of remove) next.delete(id);
    }
  }
  return next;
}
/** One owner serializes persistence, acknowledgments and polling for an open board. */
export class BoardSession {
  private state: SessionState = {
    board: null,
    pageID: "",
    elements: new Map(),
    status: "loading",
    error: null,
    pending: 0,
    canUndo: false,
    canRedo: false,
    canDiscard: false,
  };
  private listeners = new Set<() => void>();
  private base = new Map<string, Element>();
  private applied = new Map<string, number>();
  private appliedPages = new Map<string, number>();
  private observedPending = new Set<string>();
  private pending: PendingOperation[] = [];
  private undoStack: History[] = [];
  private redoStack: History[] = [];
  private historySources = new Map<string, History>();
  private navigatingHistory = false;
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private work: Promise<void> = Promise.resolve();
  private sending = false;
  private discarding = false;
  private halted = false;
  private get uncertain() {
    const head = this.pending[0];
    return !!head && (head.delivery === undefined || head.delivery === "unconfirmed");
  }
  private idlePolls = 0;
  private closeFeed: (() => void) | null = null;
  private feedReady = false;
  private nextFeedAttempt = 0;
  private after = 0;
  private generation = 0;
  private bootGeneration = 0;
  constructor(
    private id: string,
    private key: string,
    private auth: () => AuthRequestOptions,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private emit(update: Partial<SessionState> = {}) {
    if (this.controller.signal.aborted) return;
    let view = this.base;
    for (const operation of this.pending)
      if (!this.observedPending.has(operation.input.operation_id))
        view = preview(view, operation.input.commands);
    this.state = {
      ...this.state,
      ...update,
      elements: new Map(
        [...view].filter(
          ([, e]) => e.page_id === (update.pageID ?? this.state.pageID),
        ),
      ),
      pending: this.pending.length,
      canUndo: !this.pending.length && this.undoStack.length > 0,
      canRedo: !this.pending.length && this.redoStack.length > 0,
      canDiscard: this.pending.length > 0 && !this.sending && !this.discarding && !this.uncertain &&
        (update.status ?? this.state.status) !== "loading",
    };
    for (const listener of this.listeners) listener();
  }
  async start(page = "") {
    const boot = ++this.bootGeneration;
    if (this.controller.signal.aborted) this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const recovered = await readJournal(this.key);
      if (signal.aborted || boot !== this.bootGeneration) return;
      // 只移除完全没有编辑内容的旧操作；真实操作的编号和原始请求不可改写。
      const pending = recovered.filter(operation =>
        operation.input.schema_version !== BOARD_SCHEMA_VERSION || operation.input.commands.some(commandHasTargets),
      );
      if (pending.length !== recovered.length) await writeJournal(this.key, pending, recovered);
      if (signal.aborted || boot !== this.bootGeneration) return;
      this.pending = pending;
      this.halted = pending[0]?.delivery === "rejected";
      await this.loadPage(page);
      if (signal.aborted || boot !== this.bootGeneration) return;
      this.emit({
        status: this.halted ? "conflict" : this.pending.length ? "saving" : "saved",
        error: this.halted ? this.pending[0].rejection ?? "服务器已拒绝该操作，本机修改仍保留。" : null,
      });
      void this.flush();
      this.schedulePoll();
    } catch (error) {
      if (!signal.aborted && boot === this.bootGeneration)
        this.emit({ status: "error", error: (error as Error).message });
    }
  }
  async loadPage(page: string) {
    this.closeFeed?.();
    this.closeFeed = null;
    this.feedReady = false;
    const generation = ++this.generation,
      api = boardAPI(this.auth()),
      signal = this.controller.signal;
    this.emit({ status: "loading", error: null });
    const board = await api.get(this.id, 0, signal);
    const selected = board.pages.some((p) => p.id === page)
      ? page
      : board.pages[0]?.id;
    if (!selected) throw new Error("画板没有可读取的页面。");
    const loaded = new Map<string, Element>();
    let cursor = "";
    do {
      const result = await api.elements(
        this.id,
        selected,
        board.revision,
        cursor,
        signal,
      );
      for (const element of result.items) loaded.set(element.id, element);
      cursor = result.next_cursor ?? "";
      if (result.has_more && !cursor) throw new Error("画板分页回执不完整。");
    } while (cursor);
    if (signal.aborted || generation !== this.generation) return;
    this.base = loaded;
    this.applied.clear();
    this.appliedPages.clear();
    this.observedPending.clear();
    this.after = board.revision;
    const uncertain = this.pending[0];
    if (uncertain) {
      try {
        const receipt = await api.receipt(
          this.id,
          uncertain.input.operation_id,
          signal,
        );
        if (signal.aborted || generation !== this.generation) return;
        if (receipt.revision <= board.revision)
          this.observedPending.add(receipt.operation_id);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    this.emit({
      board,
      pageID: selected,
      status: this.pending.length ? "saving" : "saved",
    });
    this.openFeed();
  }
  async switchPage(page: string) {
    if (this.pending.length || this.navigatingHistory)
      throw new Error("请先同步当前页面的修改，再切换页面。");
    await this.loadPage(page);
  }
  async submit(
    commands: Command[],
    historyMode: "normal" | "undo" | "redo" = "normal",
    historySource?: History,
  ): Promise<void> {
    this.work = this.work
      .catch(() => {})
      .then(async () => {
        commands = commands.filter(commandHasTargets);
        if (!commands.length) return;
        if (this.halted) throw new Error("请先处理未同步的冲突，再继续修改。");
        if (
          this.controller.signal.aborted ||
          !this.state.board ||
          this.state.status === "loading"
        )
          throw new Error("画板尚未准备好。");
        if (this.pending.length >= 64)
          throw new Error("未同步操作过多，请先恢复网络。");
        const input: Mutation = {
          operation_id: newUUID(),
          schema_version: BOARD_SCHEMA_VERSION,
          commands,
        };
        if (
          new TextEncoder().encode(JSON.stringify(input)).byteLength >
          1024 * 1024
        )
          throw new Error("本次操作超过 1 MiB，请缩小操作范围。");
        const after = preview(this.state.elements, commands),
          before: Element[] = [];
        for (const [id, element] of this.state.elements)
          if (after.get(id) !== element) before.push(element);
        const changed =
          [...after].filter(([id, e]) => this.state.elements.get(id) !== e)
            .length + before.filter((e) => !after.has(e.id)).length;
        if (changed > MAX_COMMAND_ELEMENTS)
          throw new Error("单次操作最多修改 500 个图元，请缩小选择范围。");
        const pending: PendingOperation = {
          input,
          before,
          before_pages: this.state.board.pages,
          page_id: this.state.pageID,
          history_mode: historyMode,
          delivery: "queued",
        };
        const queue = [...this.pending, pending];
        await writeJournal(this.key, queue, this.pending);
        if (this.controller.signal.aborted) return;
        this.pending = queue;
        if (historySource)
          this.historySources.set(input.operation_id, historySource);
        if (historyMode === "normal") this.redoStack = [];
        this.emit({ status: "saving", error: null });
        void this.flush();
      });
    return this.work;
  }
  private accept(change: Change) {
    if (
      this.pending.some(
        (operation) => operation.input.operation_id === change.operation_id,
      )
    )
      this.observedPending.add(change.operation_id);
    for (const id of change.deleted)
      if ((this.applied.get(id) ?? this.after) <= change.revision) {
        this.base.delete(id);
        this.applied.set(id, change.revision);
      }
    for (const element of change.elements)
      if (
        element.page_id === this.state.pageID &&
        (this.applied.get(element.id) ?? this.after) <= change.revision
      ) {
        this.base.set(element.id, element);
        this.applied.set(element.id, change.revision);
      }
    if (this.state.board) {
      const pages = new Map(this.state.board.pages.map((p) => [p.id, p]));
      for (const id of change.deleted_pages)
        if ((this.appliedPages.get(id) ?? this.after) <= change.revision) {
          pages.delete(id);
          this.appliedPages.set(id, change.revision);
        }
      for (const page of change.pages)
        if (
          (this.appliedPages.get(page.id) ?? this.after) <= change.revision &&
          (pages.get(page.id)?.version ?? 0) <= page.version
        ) {
          pages.set(page.id, page);
          this.appliedPages.set(page.id, change.revision);
        }
      this.state = {
        ...this.state,
        board: {
          ...this.state.board,
          revision: Math.max(this.state.board.revision, change.revision),
          updated_at_ms: Math.max(
            this.state.board.updated_at_ms,
            change.updated_at_ms,
          ),
          pages: [...pages.values()].sort(
            (a, b) => a.position - b.position || a.id.localeCompare(b.id),
          ),
        },
      };
    }
  }
  private async flush() {
    if (!this.pending.length || this.sending || this.discarding || this.halted || this.controller.signal.aborted) return;
    this.sending = true;
    this.emit();
    const signal = this.controller.signal;
    let previouslyUncertain = false;
    let operationID = "";
    let stage = "journal";
    try {
      while (this.pending.length && !signal.aborted && !this.halted) {
        const operation = this.pending[0];
        operationID = operation.input.operation_id;
        previouslyUncertain = this.uncertain;
        // 必须在发请求前落盘，避免重试中断后沿用旧的“明确拒绝”记录。
        stage = "journal";
        await this.persistDelivery(operationID, "unconfirmed");
        if (signal.aborted) return;
        stage = "request";
        const change = await boardAPI(this.auth()).change(
          this.id,
          operation.input,
          signal,
        );
        if (signal.aborted) return;
        stage = "acknowledgement";
        // Queue writes and acknowledgments share the same serialization chain.
        this.work = this.work
          .catch(() => {})
          .then(async () => {
            const remaining = this.pending.filter(
              (p) => p.input.operation_id !== operation.input.operation_id,
            );
            await writeJournal(this.key, remaining, this.pending);
            if (signal.aborted) return;
            this.pending = remaining;
            this.observedPending.delete(operation.input.operation_id);
            this.accept(change);
            const source = this.historySources.get(
              operation.input.operation_id,
            );
            if (source) this.advanceHistory(source, operation, change);
            this.historySources.delete(operation.input.operation_id);
            const historyData = {
              pageID: operation.page_id,
              input: operation.input,
              before: operation.before,
              beforePages: operation.before_pages,
              change,
            };
            const history = {
              ...historyData,
              bytes: new TextEncoder().encode(JSON.stringify(historyData))
                .byteLength,
            };
            if (operation.history_mode === "undo") this.redoStack.push(history);
            else this.undoStack.push(history);
            this.trimHistory();
            this.emit({
              status: this.pending.length ? "saving" : "saved",
              error: null,
            });
          });
        await this.work;
      }
    } catch (error) {
      if (signal.aborted) return;
      const permanent =
        error instanceof ApiError &&
        [400, 401, 403, 404, 409, 413, 422].includes(error.status);
      this.halted = permanent;
      let message = boardErrorMessage(error);
      console.error("画板操作同步失败", {
        board_id: this.id, operation_id: operationID, stage,
        exception_type: error instanceof Error ? error.name : typeof error,
        reason: message,
        validation_errors: boardValidationErrors(error),
        ...(error instanceof ApiError ? { status: error.status, code: error.code, request_id: error.requestId } : {}),
      });
      // 重放被拒绝不能证明之前没有成功；只记录首次确定收到的拒绝结果。
      if (permanent && !previouslyUncertain) {
        try {
          await this.persistDelivery(operationID, "rejected", message);
        } catch (storageError) {
          message += `；拒绝结果未能保存在本机：${boardErrorMessage(storageError)}`;
          console.error("画板拒绝结果持久化失败", {
            board_id: this.id, operation_id: operationID, stage: "journal",
            exception_type: storageError instanceof Error ? storageError.name : typeof storageError,
            reason: boardErrorMessage(storageError),
          });
        }
      }
      if (signal.aborted) return;
      this.emit({
        status: permanent ? "conflict" : "offline",
        error: message,
      });
    } finally {
      this.sending = false;
      if (!signal.aborted) this.emit();
    }
  }
  private persistDelivery(operationID: string, delivery: PendingOperation["delivery"], rejection?: string) {
    const signal = this.controller.signal;
    this.work = this.work.catch(() => {}).then(async () => {
      if (signal.aborted) return;
      const queue = this.pending.map(operation => operation.input.operation_id === operationID
        ? { ...operation, delivery, rejection }
        : operation);
      await writeJournal(this.key, queue, this.pending);
      if (!signal.aborted) this.pending = queue;
    });
    return this.work;
  }
  private trimHistory() {
    let bytes = [...this.undoStack, ...this.redoStack].reduce(
      (sum, item) => sum + item.bytes,
      0,
    );
    while (
      bytes > MAX_HISTORY_BYTES ||
      this.undoStack.length + this.redoStack.length > 100
    ) {
      const undo = this.undoStack[0],
        redo = this.redoStack[0];
      const stack =
        !redo || (undo && undo.change.revision < redo.change.revision)
          ? this.undoStack
          : this.redoStack;
      const removed = stack.shift();
      if (!removed) break;
      bytes -= removed.bytes;
    }
  }
  private advanceHistory(
    source: History,
    operation: PendingOperation,
    change: Change,
  ) {
    const groups = ["geometry", "style", "text", "structure"] as const;
    const restored = new Map(
      source.before.map((element) => [element.id, element]),
    );
    const acknowledged = new Map(
      change.elements.map((element) => [element.id, element]),
    );
    const predicted = preview(
      new Map(operation.before.map((element) => [element.id, element])),
      operation.input.commands,
    );
    const transitions = new Map(
      [...acknowledged].flatMap(([id, next]) => {
        const old = restored.get(id);
        if (!old) return [];
        const element = next;
        const restore = operation.input.commands.some(
          (command) =>
            command.type === "elements.restore" &&
            command.targets.some((target) => target.id === element.id),
        );
        const changedGroups = new Set(
          groups.filter(
            (group) =>
              restore ||
              operation.input.commands.some(
                (command) =>
                  (command.type === "elements.update" ||
                    command.type === "layout.apply") &&
                  command.patches.some(
                    (patch) =>
                      patch.id === element.id && patch[group] !== undefined,
                  ),
              ),
          ),
        );
        // Whole-element deletion must still detect edits to unrelated property groups.
        const before = operation.before.find(
          (value) => value.id === element.id,
        );
        const original = source.change.elements.find(
          (value) => value.id === element.id,
        );
        const wholeVersionKnown =
          restore ||
          (before?.version === original?.version &&
            before !== undefined &&
            predicted.get(element.id)?.version === next.version);
        return [[id, { old, next, changedGroups, wholeVersionKnown }] as const];
      }),
    );
    const rebaseElement = (element: Element): Element => {
      const transition = transitions.get(element.id);
      if (!transition) return element;
      const { old, next, changedGroups, wholeVersionKnown } = transition;
      const versions = { ...element.versions };
      for (const group of changedGroups)
        if (versions[group] === old.versions[group])
          versions[group] = next.versions[group];
      return {
        ...element,
        versions,
        version:
          wholeVersionKnown && element.version === old.version
            ? next.version
            : element.version,
      };
    };
    const rebasePage = (page: BoardPage): BoardPage => {
      const old = source.beforePages.find((value) => value.id === page.id);
      const next = change.pages.find((value) => value.id === page.id);
      return old && next && page.version === old.version
        ? { ...page, version: next.version }
        : page;
    };
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      entry.before = entry.before.map(rebaseElement);
      entry.beforePages = entry.beforePages.map(rebasePage);
      entry.change = {
        ...entry.change,
        elements: entry.change.elements.map(rebaseElement),
        pages: entry.change.pages.map(rebasePage),
      };
      const { bytes: _, ...data } = entry;
      entry.bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    }
  }
  private advance(revision: number) {
    this.after = revision;
    for (const entries of [this.applied, this.appliedPages])
      for (const [id, version] of entries)
        if (version <= revision) entries.delete(id);
  }
  private openFeed() {
    if (
      this.closeFeed ||
      !this.auth().workspaceId ||
      typeof WebSocket === "undefined" ||
      this.controller.signal.aborted ||
      Date.now() < this.nextFeedAttempt
    )
      return;
    const generation = this.generation,
      signal = this.controller.signal;
    this.nextFeedAttempt = Date.now() + 5000;
    this.closeFeed = connectBoard(this.id, this.after, this.auth(), {
      ready: () => {
        if (!signal.aborted && generation === this.generation)
          this.feedReady = true;
      },
      closed: () => {
        if (generation === this.generation) {
          this.feedReady = false;
          this.closeFeed = null;
        }
      },
      changes: (items) => {
        if (signal.aborted || generation !== this.generation) return;
        for (const change of items) {
          if (change.revision <= this.after) continue;
          if (change.revision !== this.after + 1)
            throw new Error("Board revision gap");
          this.accept(change);
          this.advance(change.revision);
        }
        this.emit();
        if (
          !this.pending.length &&
          !this.state.board?.pages.some((p) => p.id === this.state.pageID)
        )
          void this.loadPage("").catch((error) =>
            this.emit({ status: "error", error: (error as Error).message }),
          );
      },
    });
  }
  private schedulePoll() {
    if (this.controller.signal.aborted) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      async () => {
        const generation = this.generation,
          signal = this.controller.signal;
        try {
          if (document.hidden && !this.pending.length) {
            this.closeFeed?.();
            this.closeFeed = null;
            this.feedReady = false;
            return;
          }
          if (this.feedReady) {
            if (!this.halted) void this.flush();
            return;
          }
          if (this.state.status !== "loading") this.openFeed();
          if (this.state.board && this.state.status !== "loading") {
            const changes = await boardAPI(this.auth()).changes(
              this.id,
              this.after,
              this.controller.signal,
            );
            if (signal.aborted || generation !== this.generation) return;
            this.idlePolls =
              changes.items.length || this.pending.length
                ? 0
                : this.idlePolls + 1;
            for (const change of changes.items) {
              if (change.revision <= this.after) continue;
              if (change.revision !== this.after + 1)
                throw new Error(
                  "画板增量存在缺口，请重新打开；本机修改仍保留。",
                );
              this.accept(change);
              this.advance(change.revision);
            }
            if (changes.items.length) {
              this.emit();
              if (
                !this.pending.length &&
                !this.state.board?.pages.some((p) => p.id === this.state.pageID)
              )
                await this.loadPage("");
            }
            if (!this.halted) void this.flush();
          }
        } catch (error) {
          if (
            !this.controller.signal.aborted &&
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          ) {
            this.halted = true;
            this.emit({
              status: "conflict",
              error: "画板已关闭或权限已变化，本机草稿仍保留。",
            });
          }
        } finally {
          this.schedulePoll();
        }
      },
      Math.min(5000, 750 * (1 + this.idlePolls)),
    );
  }
  async retry() {
    if (this.discarding || this.sending || this.state.status === "loading") return;
    this.halted = false;
    this.emit({ status: "saving", error: null });
    await this.flush();
  }
  async discardPending() {
    await this.work.catch(() => {});
    if (this.sending) throw new Error("正在确认操作结果，请稍后重试。");
    if (this.discarding) return;
    if (this.uncertain)
      throw new Error(
        "有操作的保存结果尚未确认，请先重试同步；确认结果前会保留本机修改。",
      );
    const wasHalted = this.halted;
    const previousError = this.state.error;
    this.discarding = true;
    this.halted = true;
    try {
      await this.loadPage(this.state.pageID);
      await writeJournal(this.key, [], this.pending);
      this.pending = [];
      this.historySources.clear();
      this.halted = false;
    } catch (error) {
      this.halted = wasHalted;
      this.emit({ status: wasHalted ? "conflict" : "offline", error: previousError });
      throw error;
    } finally {
      this.discarding = false;
      this.emit();
    }
    this.emit({ status: "saved", error: null });
  }
  draft() {
    return {
      schema_version: BOARD_SCHEMA_VERSION,
      board: this.state.board,
      elements: [...this.state.elements.values()],
      pending: this.pending.map((p) => p.input),
    };
  }
  private inverse(entry: History): Command[] {
    const before = new Map(entry.before.map((e) => [e.id, e])),
      commands: Command[] = [];
    const created = entry.change.elements.filter((e) => !before.has(e.id));
    if (created.length)
      commands.push({
        type: "elements.delete",
        targets: created.map((e) => ({ id: e.id, version: e.version })),
      });
    const patches: Patch[] = [];
    for (const command of entry.input.commands)
      if (command.type === "elements.update" || command.type === "layout.apply")
        for (const patch of command.patches) {
          const old = before.get(patch.id),
            ack = entry.change.elements.find((e) => e.id === patch.id);
          if (!old || !ack) continue;
          const inverse: Patch = { id: patch.id, expected: ack.versions };
          for (const group of [
            "geometry",
            "style",
            "text",
            "structure",
          ] as const)
            if (patch[group] !== undefined)
              Object.assign(inverse, { [group]: old[group] });
          patches.push(inverse);
        }
    if (patches.length) commands.push({ type: "elements.update", patches });
    if (entry.change.deleted.length)
      commands.push({
        type: "elements.restore",
        targets: entry.change.deleted.map((id) => {
          const old = before.get(id);
          if (!old)
            throw new Error("本机历史缺少删除前的数据，请从画板历史恢复。");
          return { id, version: old.version };
        }),
      });
    for (const page of entry.change.pages) {
      const old = entry.beforePages.find((p) => p.id === page.id);
      commands.push(
        old
          ? { type: "pages.update", page: { ...old, version: page.version } }
          : { type: "pages.delete", page },
      );
    }
    for (const id of entry.change.deleted_pages) {
      const page = entry.beforePages.find((p) => p.id === id);
      if (!page) throw new Error("本机缺少删除前的页面记录。");
      commands.unshift({ type: "pages.restore", page });
    }
    if (!commands.length) throw new Error("该操作没有可恢复的内容。");
    return commands;
  }
  async undo() {
    await this.navigateHistory("undo");
  }
  async redo() {
    await this.navigateHistory("redo");
  }
  private async navigateHistory(mode: "undo" | "redo") {
    const stack = mode === "undo" ? this.undoStack : this.redoStack;
    if (this.pending.length || this.navigatingHistory || !stack.length) return;
    this.navigatingHistory = true;
    try {
      const entry = stack.at(-1)!;
      if (entry.pageID !== this.state.pageID) await this.loadPage(entry.pageID);
      const commands = this.inverse(entry);
      stack.pop();
      try {
        await this.submit(commands, mode, entry);
      } catch (error) {
        stack.push(entry);
        throw error;
      }
    } finally {
      this.navigatingHistory = false;
    }
  }
  dispose() {
    this.closeFeed?.();
    this.closeFeed = null;
    this.feedReady = false;
    this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
