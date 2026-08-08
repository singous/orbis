import { useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, LogOut, MemoryStick, Plus, Search, Settings, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { ApiError } from "../../shared/api/api-client";
import type { NoteBlocks } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TextInput } from "../../shared/ui/TextInput";
import { createEmptyNoteBlocks } from "./note-contract";
import { useCreateNote, useNoteDetail, useNotesList, useSaveNoteContent } from "./notes-api";
import { useNotesUiStore } from "./notes-store";
import { TiptapNoteEditor } from "./TiptapNoteEditor";

type DraftState = {
  title: string;
  blocks: NoteBlocks;
  plainText: string;
  isDirty: boolean;
  hasConflict: boolean;
  error: string | null;
};

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function createDefaultDraft(): DraftState {
  return {
    title: "未命名笔记",
    blocks: createEmptyNoteBlocks(),
    plainText: "",
    isDirty: false,
    hasConflict: false,
    error: null,
  };
}

const navItems = [
  { label: "笔记", icon: FileText, active: true },
  { label: "文件", icon: FolderOpen, active: false },
  { label: "记忆", icon: MemoryStick, active: false },
  { label: "设置", icon: Settings, active: false },
];

function localizeSaveError(error: ApiError): string {
  if (error.detail === "Note version conflict") {
    return "服务端已有更新，请先处理版本冲突。";
  }
  if (error.detail === "Note not found") {
    return "笔记不存在或已被删除。";
  }
  return "保存失败，请稍后重试。";
}

export function NotesWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useStore(authStore, (state) => state.user);
  const clearSession = useStore(authStore, (state) => state.clearSession);
  const selectedNoteId = useNotesUiStore((state) => state.selectedNoteId);
  const setSelectedNoteId = useNotesUiStore((state) => state.setSelectedNoteId);
  const notesQuery = useNotesList();
  const notes = notesQuery.data?.items ?? [];
  const activeNoteId = selectedNoteId ?? notes[0]?.id ?? null;
  const noteQuery = useNoteDetail(activeNoteId);
  const createNoteMutation = useCreateNote();
  const saveNoteMutation = useSaveNoteContent();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DraftState>(createDefaultDraft);

  useEffect(() => {
    if (!selectedNoteId && notes[0]?.id) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes, selectedNoteId, setSelectedNoteId]);

  useEffect(() => {
    if (!noteQuery.data) {
      return;
    }
    setDraft({
      title: noteQuery.data.title,
      blocks: noteQuery.data.blocks,
      plainText: noteQuery.data.plain_text,
      isDirty: false,
      hasConflict: false,
      error: null,
    });
  }, [noteQuery.data?.id, noteQuery.data?.content_version]);

  const visibleNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return notes;
    }
    return notes.filter((note) => `${note.title} ${note.plain_text}`.toLowerCase().includes(query));
  }, [notes, search]);

  async function handleCreateNote() {
    const note = await createNoteMutation.mutateAsync({
      title: "未命名笔记",
      blocks: createEmptyNoteBlocks(),
      plain_text: "",
      note_type: "doc",
    });
    setSelectedNoteId(note.id);
  }

  async function handleSave() {
    if (!noteQuery.data) {
      return;
    }

    try {
      await saveNoteMutation.mutateAsync({
        noteId: noteQuery.data.id,
        expectedVersion: noteQuery.data.content_version,
        title: draft.title.trim() || "未命名笔记",
        blocks: draft.blocks,
        plainText: draft.plainText,
      });
      setDraft((current) => ({
        ...current,
        isDirty: false,
        hasConflict: false,
        error: null,
      }));
    } catch (error) {
      const apiError = error as ApiError;
      setDraft((current) => ({
        ...current,
        hasConflict: apiError.isConflict,
        error: apiError.isConflict ? null : localizeSaveError(apiError),
      }));
    }
  }

  async function handleRefreshServerVersion() {
    if (!noteQuery.data) {
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["notes", noteQuery.data.id] });
    setDraft((current) => ({ ...current, hasConflict: false, error: null }));
  }

  function handleLogout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-[var(--text)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[76px_320px_minmax(0,1fr)_280px]">
        <aside className="hidden border-r border-[var(--border)] bg-[var(--chrome)] px-3 py-4 lg:flex lg:flex-col lg:items-center">
          <div className="mb-8 grid h-10 w-10 place-items-center rounded-md bg-[var(--text)] text-sm font-semibold text-white">
            O
          </div>
          <nav className="flex flex-1 flex-col items-center gap-2" aria-label="工作区">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  className={[
                    "grid h-10 w-10 place-items-center rounded-md transition",
                    item.active
                      ? "bg-white text-[var(--accent-strong)] shadow-sm"
                      : "text-[var(--muted-light)] hover:bg-white hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            aria-label="退出登录"
            title="退出登录"
            onClick={handleLogout}
            className="grid h-10 w-10 place-items-center rounded-md text-[var(--muted-light)] hover:bg-white hover:text-[var(--text)]"
          >
            <LogOut aria-hidden="true" size={18} />
          </button>
        </aside>

        <section className="border-r border-[var(--border)] bg-[var(--panel)] px-4 py-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-light)]">Orbis</div>
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--text)]">笔记</h1>
            </div>
            <Button
              aria-label="新建笔记"
              variant="primary"
              icon={<Plus aria-hidden="true" size={16} />}
              onClick={handleCreateNote}
              disabled={createNoteMutation.isPending}
            >
              新建
            </Button>
          </div>

          <div className="relative mb-4">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" size={16} />
            <TextInput
              aria-label="搜索笔记"
              className="pl-9"
              placeholder="搜索笔记"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {notesQuery.isLoading ? <StatusMessage title="正在加载笔记" /> : null}
          {notesQuery.isError ? (
            <StatusMessage tone="error" title="无法加载笔记">
              请确认后端服务已启动并保持可访问。
            </StatusMessage>
          ) : null}

          {!notesQuery.isLoading && visibleNotes.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border)] bg-white p-5 text-sm">
              <div className="font-semibold text-[var(--text)]">还没有笔记</div>
              <p className="mt-1 leading-6 text-[var(--muted)]">创建第一条笔记，开始沉淀你的 Orbis 记忆层。</p>
              <Button className="mt-4" aria-label="创建笔记" variant="primary" onClick={handleCreateNote}>
                创建笔记
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => setSelectedNoteId(note.id)}
                  className={[
                    "rounded-md border p-3 text-left transition",
                    activeNoteId === note.id
                      ? "border-[var(--accent-border)] bg-white shadow-sm"
                      : "border-transparent bg-transparent hover:border-[var(--border)] hover:bg-white",
                  ].join(" ")}
                >
                  <div className="line-clamp-1 text-sm font-semibold text-[var(--text)]">{note.title}</div>
                  <div className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--muted)]">
                    {note.plain_text || "暂无内容"}
                  </div>
                  <div className="mt-2 text-[11px] text-[var(--muted-light)]">{formatTime(note.updated_at_ms)}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 bg-[var(--workspace)] px-4 py-4 lg:px-8 lg:py-6">
          {!noteQuery.data ? (
            <div className="grid min-h-[70vh] place-items-center rounded-md border border-dashed border-[var(--border)] bg-white text-center">
              <div>
                <Sparkles aria-hidden="true" className="mx-auto mb-3 text-[var(--accent)]" size={24} />
                <div className="text-base font-semibold">选择或创建一条笔记</div>
                <p className="mt-2 text-sm text-[var(--muted)]">你的写作空间会显示在这里。</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <input
                    aria-label="笔记标题"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        title: event.target.value,
                        isDirty: true,
                        hasConflict: false,
                        error: null,
                      }))
                    }
                    className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-[-0.02em] text-[var(--text)] outline-none"
                  />
                  <div className="mt-1 text-xs text-[var(--muted-light)]">
                    版本 {noteQuery.data.content_version} · 更新于 {formatTime(noteQuery.data.updated_at_ms)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">
                    {saveNoteMutation.isPending ? "保存中..." : draft.isDirty ? "有未保存修改" : "已保存"}
                  </span>
                  <Button aria-label="保存笔记" variant="primary" onClick={handleSave} disabled={saveNoteMutation.isPending}>
                    保存
                  </Button>
                </div>
              </div>

              {draft.hasConflict ? (
                <div className="mb-4">
                  <StatusMessage tone="warning" title="版本冲突">
                    服务端有更新版本。你的本地编辑仍会保留。
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={handleRefreshServerVersion}>
                        刷新服务端版本
                      </Button>
                    </div>
                  </StatusMessage>
                </div>
              ) : null}

              {draft.error ? (
                <div className="mb-4">
                  <StatusMessage tone="error" title="保存失败">
                    {draft.error}
                  </StatusMessage>
                </div>
              ) : null}

              <TiptapNoteEditor
                blocks={draft.blocks}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    blocks: next.blocks,
                    plainText: next.plainText,
                    isDirty: true,
                    hasConflict: false,
                    error: null,
                  }))
                }
              />
            </div>
          )}
        </section>

        <aside className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-4 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold">上下文</div>
            <div className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">实时</div>
          </div>
          <div className="grid gap-3 text-sm">
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">账号</div>
              <div className="mt-2 font-medium">{user?.display_name || user?.email || "本地会话"}</div>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">摘要</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                {draft.plainText || "暂未提取纯文本。"}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">同步状态</div>
              <div className="mt-2 text-sm text-[var(--muted)]">
                {draft.hasConflict ? "存在冲突待处理" : draft.isDirty ? "本地草稿已修改" : "服务端版本已同步"}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
