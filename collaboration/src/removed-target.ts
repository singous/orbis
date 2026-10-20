import * as Y from "yjs";
import { EngineError } from "./protocol";
import { fingerprintElement, fingerprintValue, COLLABORATION_ATOMIC_ATTRIBUTES } from "../../frontend/src/features/content/codecs/collaboration-fingerprint";
import { MAX_TARGETS } from "./protocol";

export type Target = { client: number; clock: number; content_hash?: string };

export function validateTargets(value: unknown): Target[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TARGETS) throw new EngineError("INVALID_REQUEST");
  for (const target of value) {
    if (!target || typeof target !== "object" || Object.keys(target).some(key => !["client", "clock", "content_hash"].includes(key)) ||
      !Number.isInteger(target.client) || target.client < 0 || target.client > 0xffffffff ||
      !Number.isSafeInteger(target.clock) || target.clock < 0 ||
      (target.content_hash !== undefined && (typeof target.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(target.content_hash)))) throw new EngineError("INVALID_REQUEST");
  }
  return value;
}

function contains(ranges: Array<{ clock: number; len: number }> | undefined, clock: number): boolean {
  if (!ranges) return false;
  let left = 0, right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1, range = ranges[middle];
    if (clock < range.clock) right = middle;
    else if (clock >= range.clock + range.len) left = middle + 1;
    else return true;
  }
  return false;
}

export function assertStructuralTargets(doc: Y.Doc, update: Uint8Array, targets: Target[]) {
  const deleted = Y.decodeUpdate(update).ds;
  const removes = (item: Y.Item) => contains(deleted.clients.get(item.id.client), item.id.clock);
  const proofs = new Map(targets.map(target => [`${target.client}:${target.clock}`, target.content_hash]));
  for (const [client, ranges] of deleted.clients) {
    const structs = doc.store.clients.get(client);
    if (!structs) continue;
    for (const item of structs) {
      if (!(item instanceof Y.Item) || item.deleted || !contains(ranges, item.id.clock) ||
        !(item.content instanceof Y.ContentType) || !(item.content.type instanceof Y.XmlElement)) continue;
      const element = item.content.type;
      if (!element.getAttribute("orbisId")) continue;
      let ancestor = item.parent, covered = false;
      while (ancestor instanceof Y.AbstractType && ancestor._item) {
        if (ancestor instanceof Y.XmlElement && ancestor.getAttribute("orbisId") && removes(ancestor._item)) { covered = true; break; }
        ancestor = ancestor._item.parent;
      }
      if (!covered && proofs.get(`${item.id.client}:${item.id.clock}`) !== fingerprintElement(element)) throw new EngineError("EDIT_TARGET_REMOVED");
    }
  }
}

const ATOMIC_ATTRIBUTES = new Set<string>(COLLABORATION_ATOMIC_ATTRIBUTES);
type AtomicTarget = { element: Y.XmlElement; owner: string; attributes: Map<string, unknown> };
export function atomicTargetProofs(doc: Y.Doc): Map<string, AtomicTarget> {
  const originals = new Map<string, AtomicTarget>();
  const visit = (fragment: Y.XmlFragment, owner?: string) => {
    for (const child of fragment.toArray()) if (child instanceof Y.XmlElement) {
      const identity = child._item ? `${child._item.id.client}:${child._item.id.clock}` : undefined;
      const anchor = child.getAttribute("orbisId") && identity ? identity : owner;
      if (identity && anchor) originals.set(identity, { element: child, owner: anchor, attributes: new Map([...ATOMIC_ATTRIBUTES].map(name => [name, child.getAttribute(name)])) });
      visit(child, anchor);
    }
  };
  visit(doc.getXmlFragment("body"));
  return originals;
}

/** Whole business objects/arrays are atomic. Inspect losing map writes as well
 * as visible changes; the closest owning block proves cell metadata too. */
export function assertAtomicTargets(doc: Y.Doc, previous: Map<number, number>, originals: Map<string, AtomicTarget>, targets: Target[]) {
  if (!originals.size) return;
  const proofs = new Map(targets.map(target => [`${target.client}:${target.clock}`, target.content_hash]));
  const requireProof = (target: AtomicTarget) => { if (!proofs.get(target.owner)) throw new EngineError("EDIT_TARGET_REMOVED"); };
  const same = (left: unknown, right: unknown) => left === right || fingerprintValue(left) === fingerprintValue(right);
  for (const target of originals.values()) {
    if (target.element._item?.deleted) continue;
    for (const [name, before] of target.attributes) if (!same(before, target.element.getAttribute(name))) { requireProof(target); break; }
  }
  for (const [client, structs] of doc.store.clients) {
    const before = previous.get(client) ?? 0;
    for (const item of structs) {
      if (!(item instanceof Y.Item) || item.id.clock + item.length <= before || !item.parentSub || !ATOMIC_ATTRIBUTES.has(item.parentSub) ||
        !(item.parent instanceof Y.XmlElement) || !item.parent._item || item.parent._item.deleted) continue;
      const identity = item.parent._item.id, key = `${identity.client}:${identity.clock}`;
      const original = originals.get(key);
      if (original && !same(original.attributes.get(item.parentSub), item.content.getContent()[0])) requireProof(original);
    }
  }
}

/** Check the original editor node identity against current persisted state.
 * Unlike a stable block UUID, an XML Item ID changes when a subtree moves.
 * This also protects delete-only edits whose DeleteSet is otherwise ambiguous. */
export function assertTargets(doc: Y.Doc, targets: Target[]) {
  const fingerprints = new Map<string, string>();
  for (const target of targets) {
    const structs = doc.store.clients.get(target.client);
    if (!structs || target.clock >= structs.at(-1)!.id.clock + structs.at(-1)!.length) continue;
    const item = Y.getItem(doc.store, Y.createID(target.client, target.clock));
    if (!(item instanceof Y.Item) || item.id.clock !== target.clock || !(item.content instanceof Y.ContentType) || !(item.content.type instanceof Y.XmlElement)) throw new EngineError("INVALID_REQUEST");
    if (item.deleted) throw new EngineError("EDIT_TARGET_REMOVED");
    if (target.content_hash) {
      const identity = `${target.client}:${target.clock}`;
      const current = fingerprints.get(identity) ?? fingerprintElement(item.content.type);
      fingerprints.set(identity, current);
      if (current !== target.content_hash) throw new EngineError("EDIT_TARGET_REMOVED");
    }
    let parent = item.parent;
    while (parent instanceof Y.AbstractType && parent._item) {
      if (parent._item.deleted) throw new EngineError("EDIT_TARGET_REMOVED");
      parent = parent._item.parent;
    }
  }
}

/** XmlFragment moves delete the old subtree and insert a copy. Reject updates
 * authored against that removed subtree rather than acknowledging edits which
 * Yjs would place only in tombstones. The caller retains the original update
 * for explicit recovery. Ordinary rich-text removals remain mergeable. */
export function assertRetainedTargets(doc: Y.Doc, update: Uint8Array, previous: Map<number, number>) {
  const decoded = Y.decodeUpdate(update);
  const intentionallyDeleted = (item: Y.Item) => contains(decoded.ds.clients.get(item.id.client), item.id.clock);
  for (const [client, structs] of doc.store.clients) {
    const before = previous.get(client) ?? 0;
    for (const struct of structs) {
      if (!(struct instanceof Y.Item) || struct.id.clock + struct.length <= before || intentionallyDeleted(struct)) continue;
      let parent = struct.parent;
      while (parent instanceof Y.AbstractType && parent._item) {
        if (parent._item.deleted) throw new EngineError("EDIT_TARGET_REMOVED");
        parent = parent._item.parent;
      }
    }
  }
}
