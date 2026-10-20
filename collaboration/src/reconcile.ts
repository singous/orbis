import * as Y from "yjs";
import type { Node as PMNode } from "@tiptap/pm/model";
import { prosemirrorToYXmlFragment, updateYFragment, initProseMirrorDoc } from "y-prosemirror";
import { schema } from "./schema";

function ownIdentity(node: PMNode) { return typeof node.attrs.orbisId === "string" && !node.attrs.orbisOwn ? node.attrs.orbisId as string : null; }
function descendantIDs(node: PMNode): string[] {
  const ids: string[] = [];
  if (ownIdentity(node)) ids.push(ownIdentity(node)!);
  node.descendants(child => { const id = ownIdentity(child); if (id) ids.push(id); });
  return ids;
}
function xmlIDs(node: Y.XmlElement): string[] {
  const ids: string[] = [];
  const visit = (element: Y.XmlElement) => {
    if (typeof element.getAttribute("orbisId") === "string" && !element.getAttribute("orbisOwn")) ids.push(element.getAttribute("orbisId") as string);
    for (const child of element.toArray()) if (child instanceof Y.XmlElement) visit(child);
  };
  visit(node);
  return ids;
}
function newElement(pm: PMNode): Y.XmlElement {
  const scratch = new Y.Doc();
  try {
    const fragment = scratch.getXmlFragment("body");
    prosemirrorToYXmlFragment(schema.topNodeType.create(null, [pm]), fragment);
    return (fragment.get(0) as Y.XmlElement).clone();
  } finally { scratch.destroy(); }
}
// The longest increasing subsequence retains every node that need not move.
// This is O(n log n) for the 10,000 block content contract.
function retainedIndices(sequence: number[]): Set<number> {
  const tails: number[] = [], previous = Array(sequence.length).fill(-1);
  sequence.forEach((value, index) => {
    if (value < 0) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (sequence[tails[middle]] < value) lo = middle + 1; else hi = middle; }
    if (lo > 0) previous[index] = tails[lo - 1];
    tails[lo] = index;
  });
  const result = new Set<number>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) { result.add(cursor); cursor = previous[cursor]; }
  return result;
}
function attrs(element: Y.XmlElement, pm: PMNode) {
  const existing = element.getAttributes();
  for (const [key, value] of Object.entries(pm.attrs)) {
    if (value == null) { if (key in existing) element.removeAttribute(key); }
    else if (JSON.stringify(existing[key]) !== JSON.stringify(value)) element.setAttribute(key, value);
  }
  for (const key of Object.keys(existing)) if (!(key in pm.attrs)) element.removeAttribute(key);
}

/** Reconcile API intents against the authoritative CRDT. Position-only diffing
 * can repurpose another block's XML/text identity after insertion or movement.
 * Stable block IDs choose retained nodes before the inline binding runs. */
export function reconcile(doc: Y.Doc, fragment: Y.XmlFragment, pm: PMNode, mapping = initProseMirrorDoc(fragment, schema).mapping) {
  const previous = mapping.get(fragment);
  if (previous && !Array.isArray(previous) && previous.eq(pm)) return;
  const desired: PMNode[] = [];
  pm.forEach(child => desired.push(child));
  const current = fragment.toArray();
  const structural = desired.some(child => descendantIDs(child).length > 0) || current.some(child => child instanceof Y.XmlElement && xmlIDs(child).length > 0);
  if (!structural) {
    updateYFragment(doc, fragment, pm, { mapping: new Map(), isOMark: new Map() });
    return;
  }
  if (fragment instanceof Y.XmlElement) attrs(fragment, pm);
  const used = new Set<Y.XmlElement>();
  const elements = current.filter((child): child is Y.XmlElement => child instanceof Y.XmlElement);
  const owners = new Map<string, Y.XmlElement>();
  for (const element of elements) for (const id of xmlIDs(element)) owners.set(id, element);
  const matches: Array<Y.XmlElement | null> = desired.map(child => {
    const identity = ownIdentity(child);
    if (identity) {
      const candidate = owners.get(identity);
      if (candidate?.nodeName === child.type.name && candidate.getAttribute("orbisId") === identity && !used.has(candidate)) { used.add(candidate); return candidate; }
      return null;
    }
    // List wrappers and own-body paragraphs carry no independent block ID.
    // Retain an existing wrapper by a surviving descendant or its node type.
    for (const id of descendantIDs(child)) {
      const candidate = owners.get(id);
      if (candidate?.nodeName === child.type.name && !used.has(candidate)) { used.add(candidate); return candidate; }
    }
    const candidate = elements.find(element => !used.has(element) && element.nodeName === child.type.name && !element.getAttribute("orbisId"));
    if (candidate) { used.add(candidate); return candidate; }
    return null;
  });
  const positions = new Map(current.map((child, index) => [child, index]));
  const retained = retainedIndices(matches.map(match => match ? positions.get(match)! : -1));
  const keep = new Set([...retained].map(index => matches[index]!));
  for (let index = current.length - 1; index >= 0; index--) if (!keep.has(current[index] as Y.XmlElement)) fragment.delete(index, 1);
  for (let index = 0; index < desired.length; index++) {
    const child = desired[index];
    if (retained.has(index)) reconcile(doc, matches[index]!, child, mapping);
    else fragment.insert(index, [newElement(child)]);
  }
}
