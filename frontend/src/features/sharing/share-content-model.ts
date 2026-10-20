import type { PublicShare, SharedContentPage } from "./api";

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  quote: "引用",
  callout: "提示",
  card: "卡片",
  cardGroup: "卡片组",
  steps: "步骤",
  step: "步骤",
  tabs: "标签组",
  tab: "标签",
  codeGroup: "代码组",
  toggleListItem: "折叠段落",
  bulletListItem: "列表",
  numberedListItem: "列表",
  checkListItem: "待办事项",
};

export function sharedNoteLink(
  value: string,
  token: string,
  allowed: Set<string>,
  origin: string,
): string {
  let candidate = value;
  let privateDocumentPath = false;
  if (!value.startsWith("orbis-note:")) {
    try {
      const url = new URL(value, origin);
      if (
        url.origin === new URL(origin).origin &&
        url.pathname.startsWith("/documents/")
      ) {
        privateDocumentPath = true;
        candidate = url.pathname + url.search + url.hash;
      }
    } catch {
      /* Non-URL text is not a document reference. */
    }
  }
  const match =
    /^(?:orbis-note:|\/documents\/)([0-9a-f-]{36})\/?(#[A-Za-z0-9_-]+)?$/i.exec(
      candidate,
    );
  if (!match)
    return privateDocumentPath ||
      value.startsWith("orbis-note:") ||
      value.startsWith("/documents/")
      ? ""
      : value;
  const noteId = match[1].toLowerCase();
  return allowed.has(noteId)
    ? new URL(
        `/share/${encodeURIComponent(token)}/${noteId}${match[2] ?? ""}`,
        origin,
      ).href
    : "";
}

export function hydratedSharedBlocks(
  pages: SharedContentPage[],
  manifest: PublicShare,
  token: string,
  origin: string,
) {
  const byParent = new Map<string | null, Record<string, unknown>[]>();
  const allowed = new Set(manifest.items.map((item) => item.id));
  for (const page of pages) {
    const siblings = byParent.get(page.parent_id) ?? [];
    siblings.push(...page.blocks.blocks);
    byParent.set(page.parent_id, siblings);
  }
  const walk = (parent: string | null): Record<string, unknown>[] =>
    (byParent.get(parent) ?? []).map((block) => ({
      ...block,
      children: walk(String(block.id)),
    }));
  return { schema_version: 2, editor: "blocknote", blocks: walk(null) };
}

export function pendingSharedBranches(pages: SharedContentPage[]) {
  const branches = new Map<
    string,
    { id: string; count: number; loaded: number; label: string }
  >();
  for (const page of pages)
    for (const descriptor of page.descriptors) {
      if (!descriptor.has_children) continue;
      const block = page.blocks.blocks.find(
        (item) => item.id === descriptor.id,
      );
      const props = block?.props as Record<string, unknown> | undefined;
      const label =
        typeof props?.title === "string" && props.title
          ? props.title
          : `${BLOCK_LABELS[String(block?.type)] ?? "段落"}子内容`;
      branches.set(descriptor.id, {
        id: descriptor.id,
        count: descriptor.child_count,
        loaded: 0,
        label,
      });
    }
  for (const page of pages)
    if (page.parent_id && branches.has(page.parent_id))
      branches.get(page.parent_id)!.loaded += page.blocks.blocks.length;
  return [...branches.values()].filter(
    (branch) => branch.loaded < branch.count,
  );
}
