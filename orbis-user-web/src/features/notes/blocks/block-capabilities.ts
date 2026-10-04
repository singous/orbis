import { documentBlockDefinition } from "../../content/document-components";
import type { OrbisBlock } from "../block-model";
import { indexBlocks, normalizeBlockSelection, type BlockAction, type BlockAddress } from "./block-tree";

export type { BlockAction } from "./block-tree";
export type BlockAvailability = { ok: boolean; message?: string };
export const TEXT_CONVERSION_TARGETS = ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "toggleListItem"] as const;
export const BLOCK_GROUP_KINDS = ["group", "cardGroup", "steps", "tabs", "codeGroup"] as const;
const OWNED_CHILDREN: Record<string, string> = { step: "steps", tab: "tabs" };
const ok: BlockAvailability = { ok: true };
const no = (message: string): BlockAvailability => ({ ok: false, message });

/** Complex blocks expose whole-block operations; their internal editor owns input. */
export function blockCapabilities(type: string) {
  const definition = documentBlockDefinition(type);
  return {
    children: definition?.children ?? "any" as const,
    conversionTargets: (TEXT_CONVERSION_TARGETS as readonly string[]).includes(type) ? TEXT_CONVERSION_TARGETS : [],
    interaction: ["table", "codeBlock", "image", "video", "audio", "file"].includes(type) ? "embedded" as const : "text" as const,
    copy: "author-content-and-resource-references" as const,
    readonly: "render" as const,
  };
}

export function acceptsBlock(parent: OrbisBlock | null, child: OrbisBlock): boolean {
  if (OWNED_CHILDREN[child.type] && parent?.type !== OWNED_CHILDREN[child.type]) return false;
  const allowed = parent ? blockCapabilities(parent.type).children : "any";
  return allowed === "any" || allowed.includes(child.type);
}

function consecutive(addresses: BlockAddress[]): boolean {
  return addresses.every((address, index) => address.parentId === addresses[0].parentId && address.index === addresses[0].index + index);
}

function conversionAvailability(block: OrbisBlock, target: string): BlockAvailability {
  if (!(TEXT_CONVERSION_TARGETS as readonly string[]).includes(block.type) || !(TEXT_CONVERSION_TARGETS as readonly string[]).includes(target)) {
    return no("此块不能无损转换为该类型，请使用组合保留原内容");
  }
  if (target === "codeBlock" && Array.isArray(block.content) && block.content.some((part) => part.type === "link" || Object.values(part.styles ?? {}).some(Boolean))) {
    return no("转换为代码会丢失文字格式或链接，请先移除格式或使用组合");
  }
  return ok;
}

export type BlockActionContext = { index: ReadonlyMap<string, BlockAddress>; addresses: BlockAddress[] };

/** A menu checks many actions against the same immutable selection once. */
export function createBlockActionContext(blocks: OrbisBlock[], ids: string[], index: ReadonlyMap<string, BlockAddress> = indexBlocks(blocks)): BlockActionContext {
  const selected = new Set(ids);
  const addresses = [...new Set(ids)].map(id => index.get(id)).filter((address): address is BlockAddress => Boolean(address));
  const outer = addresses.filter(address => {
    let parentId = address.parentId;
    while (parentId) { if (selected.has(parentId)) return false; parentId = index.get(parentId)?.parentId ?? null; }
    return true;
  });
  outer.sort((a, b) => { for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) { if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i]; } return a.path.length - b.path.length; });
  return { index, addresses: outer };
}

export function blockActionAvailability(blocks: OrbisBlock[], ids: string[], action: BlockAction, context?: BlockActionContext): BlockAvailability {
  if (!ids.length) return no("请选择仍然存在的块");
  const index = context?.index ?? indexBlocks(blocks);
  if (!ids.length || ids.some((id) => !index.has(id))) return no("请选择仍然存在的块");
  const addresses = context?.addresses ?? normalizeBlockSelection(blocks, ids).map((id) => index.get(id)!);
  const selected = new Set(addresses.map(({ id }) => id));
  const parent = (address: BlockAddress) => address.parentId ? index.get(address.parentId)!.block : null;
  const accepts = (destination: OrbisBlock | null, children = addresses.map(({ block }) => block)) => children.every((child) => acceptsBlock(destination, child));
  const first = addresses[0]; const last = addresses[addresses.length - 1];
  switch (action.type) {
    case "delete": return ok;
    case "duplicate": return accepts(parent(last)) ? ok : no("选区末尾的容器不接受所有副本，请分别复制");
    case "insert":
      return accepts(parent(action.side === "before" ? first : last), [{ ...first.block, type: "paragraph" }]) ? ok : no("此容器不接受普通段落");
    case "paste": {
      if (!action.blocks.length) return no("剪贴板中没有可插入的块");
      if (!accepts(parent(action.side === "before" ? first : last), action.blocks)) return no("此容器不接受剪贴板中的块类型");
      const seen = new Set<string>();
      const valid = (children: OrbisBlock[], owner: OrbisBlock | null): boolean => children.every((block) => {
        if (!acceptsBlock(owner, block) || (action.preserveIds && (!block.id || seen.has(block.id)))) return false;
        seen.add(block.id);
        return valid(block.children, block);
      });
      if (!valid(action.blocks, parent(action.side === "before" ? first : last))) return no("剪贴板包含非法嵌套或重复块标识");
      const incoming = indexBlocks(action.blocks);
      if (action.preserveIds && [...incoming.keys()].some((id) => index.has(id))) return no("剪切块已存在，无法重复保留其标识");
      return ok;
    }
    case "move": {
      const target = index.get(action.targetId);
      if (!target) return no("目标块已不存在");
      let ancestor: BlockAddress | undefined = target;
      while (ancestor) {
        if (selected.has(ancestor.id)) return no("不能将块移动到自身或后代中");
        ancestor = ancestor.parentId ? index.get(ancestor.parentId) : undefined;
      }
      return accepts(action.placement === "inside" ? target.block : parent(target)) ? ok : no("目标容器不接受所选块类型");
    }
    case "up": case "down": {
      const available = addresses.some((address) => {
        const siblings = parent(address)?.children ?? blocks;
        const neighbor = siblings[address.index + (action.type === "up" ? -1 : 1)];
        return neighbor && !selected.has(neighbor.id);
      });
      return available ? ok : no(action.type === "up" ? "已经位于最上方" : "已经位于最下方");
    }
    case "indent": {
      if (!consecutive(addresses)) return no("缩进需要选择同级连续块");
      const siblings = parent(first)?.children ?? blocks;
      const previous = siblings[first.index - 1];
      return previous && accepts(previous) ? ok : no("前方没有可以容纳所选块的同级块");
    }
    case "outdent":
      return addresses.every((address) => {
        const owner = address.parentId ? index.get(address.parentId) : undefined;
        return owner && acceptsBlock(parent(owner), address.block);
      }) ? ok : no("所选块已在顶层，或提升后会脱离所需的业务容器");
    case "convert": {
      if (action.target === "heading" && action.level !== undefined && ![1, 2, 3, 4, 5, 6].includes(action.level)) return no("标题级别必须为 1 至 6");
      for (const address of addresses) {
        const result = conversionAvailability(address.block, action.target);
        if (!result.ok) return result;
        if (!acceptsBlock(parent(address), { ...address.block, type: action.target })) return no("当前容器不接受转换后的块类型");
      }
      return ok;
    }
    case "group": {
      const type = action.kind ?? "group";
      if (!(BLOCK_GROUP_KINDS as readonly string[]).includes(type)) return no("不支持此组合类型");
      if (!consecutive(addresses)) return no("组合需要选择同级连续块");
      const group: OrbisBlock = { id: "", type, props: {}, content: [], children: [] };
      return acceptsBlock(parent(first), group) && accepts(group) ? ok : no("所选块不符合此组合的类型要求");
    }
    case "ungroup":
      return addresses.every((address) => address.block.type === "group" && accepts(parent(address), address.block.children)) ? ok : no("仅透明组合支持无损取消组合");
  }
}
