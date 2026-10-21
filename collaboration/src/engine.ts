import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { nativeBlock, nativeBlockSchema, editorBlock, type NativeBlock } from "../../frontend/src/features/content/codecs/api-content";
import { fromTiptapDocument, toTiptapDocument } from "../../frontend/src/features/documents/editor/tiptap-model";
import { schema } from "./schema";
import { reconcile } from "./reconcile";
import { assertRetainedTargets, assertTargets, assertStructuralTargets, atomicTargetProofs, assertAtomicTargets, validateTargets, type Target } from "./removed-target";
import { EngineError, MAX_BINARY_BYTES, MAX_BLOCKS, MAX_CONTENT_BYTES, MAX_DEPTH } from "./protocol";

const LEGACY_CACHE_ATTRIBUTES = new Set(["orbisOriginal", "orbisSignature", "orbisCellOriginal"]);

export type TransformRequest = { state: string | null; blocks: NativeBlock[] | null; update: string | null; targets?: Target[] | null };
export type TransformResult = { state: string; update: string; state_vector: string; changed: boolean; blocks: NativeBlock[] };
export function binary(value: string, code: "INVALID_STATE" | "INVALID_UPDATE"): Uint8Array {
  if (value.length > Math.ceil(MAX_BINARY_BYTES / 3) * 4) throw new EngineError("CONTENT_TOO_LARGE");
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw new EngineError(code);
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.toString("base64") !== value) throw new EngineError(code);
  return bytes;
}
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
function validateBlocks(value: unknown): NativeBlock[] {
  if (!Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_CONTENT_BYTES) throw new EngineError("CONTENT_TOO_LARGE");
  const ids = new Set<string>();
  const visit = (blocks: unknown[], depth: number) => {
    if (!blocks.length) return;
    if (depth > MAX_DEPTH) throw new EngineError("INVALID_CONTENT");
    for (const raw of blocks) {
      if (!raw || typeof raw !== "object") throw new EngineError("INVALID_CONTENT");
      const block = raw as NativeBlock;
      if (ids.has(block.id) || ids.size >= MAX_BLOCKS || !Array.isArray(block.children)) throw new EngineError("INVALID_CONTENT");
      ids.add(block.id);
      visit(block.children, depth + 1);
    }
  };
  visit(value, 1);
  try { return value.map(block => nativeBlockSchema.parse(block)); } catch { throw new EngineError("INVALID_CONTENT"); }
}
function assertYjs(doc: Y.Doc) {
  // A partial update must not be acknowledged as durable before its missing
  // causal dependencies arrive; a caller may resend it after a full resync.
  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null || [...doc.share.keys()].some(key => key !== "body")) throw new EngineError("INVALID_UPDATE");
  const fragment = doc.getXmlFragment("body");
  const visit = (value: Y.XmlFragment | Y.XmlElement, depth: number) => {
    if (depth > MAX_DEPTH * 5) throw new EngineError("INVALID_CONTENT");
    for (const child of value.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (!schema.nodes[child.nodeName]) throw new EngineError("INVALID_CONTENT");
        for (const name of Object.keys(child.getAttributes())) if (!schema.nodes[child.nodeName].spec.attrs?.[name] && !LEGACY_CACHE_ATTRIBUTES.has(name)) throw new EngineError("INVALID_CONTENT");
        visit(child, depth + 1);
      } else if (!(child instanceof Y.XmlText)) throw new EngineError("INVALID_CONTENT");
    }
  };
  visit(fragment, 0);
}
function pmBlocks(doc: Y.Doc): NativeBlock[] {
  assertYjs(doc);
  const body = doc.getXmlFragment("body");
  if (body.length === 0) return [];
  const pm = yXmlFragmentToProseMirrorRootNode(body, schema);
  pm.check();
  // Never silently generate a new stable block identity while projecting a
  // malformed update. Duplicate identities also fail validation below.
  pm.descendants((node, _position, parent, index) => {
    const helper = node.type.name === "paragraph" &&
      ((["listItem", "taskItem"].includes(parent?.type.name ?? "") && index === 0) ||
      ["tableCell", "tableHeader"].includes(parent?.type.name ?? ""));
    if (node.type.spec.attrs?.orbisId && !node.attrs.orbisOwn && !helper && !["tableCell", "tableHeader"].includes(node.type.name) &&
      (typeof node.attrs.orbisId !== "string" || !node.attrs.orbisId)) throw new EngineError("INVALID_CONTENT");
    if (node.type.name === "table") return false;
  });
  return validateBlocks(fromTiptapDocument(pm).blocks.map(nativeBlock));
}
export function transform(request: TransformRequest): TransformResult {
  if (!request || typeof request !== "object" || Object.keys(request).some(key => !["state", "blocks", "update", "targets"].includes(key)) ||
    (request.state !== null && typeof request.state !== "string") || (request.update !== null && typeof request.update !== "string") ||
    (request.blocks !== null && !Array.isArray(request.blocks)) || (!request.state && request.blocks === null) || (request.blocks !== null && request.update !== null)) throw new EngineError("INVALID_REQUEST");
  const targets = validateTargets(request.targets);
  if (targets.length && request.update === null) throw new EngineError("INVALID_REQUEST");
  const doc = new Y.Doc({ gc: false });
  try {
    if (request.state !== null) {
      try { Y.applyUpdate(doc, binary(request.state, "INVALID_STATE")); assertYjs(doc); } catch (error) { if (error instanceof EngineError) throw error; throw new EngineError("INVALID_STATE"); }
    }
    const before = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc);
    if (request.update !== null) {
      try {
        assertTargets(doc, targets);
        const update = binary(request.update, "INVALID_UPDATE");
        assertStructuralTargets(doc, update, targets);
        const previous = Y.decodeStateVector(vector);
        const atomic = atomicTargetProofs(doc);
        Y.applyUpdate(doc, update);
        assertRetainedTargets(doc, update, previous);
        assertAtomicTargets(doc, previous, atomic, targets);
      } catch (error) { if (error instanceof EngineError) throw error; throw new EngineError("INVALID_UPDATE"); }
    }
    if (request.blocks !== null) {
      const blocks = validateBlocks(request.blocks);
      const pm = blocks.length ? schema.nodeFromJSON(toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: blocks.map(editorBlock) }, { cacheMetadata: false })) : schema.topNodeType.create();
      pm.check();
      const fragment = doc.getXmlFragment("body");
      if (request.state === null) prosemirrorToYXmlFragment(pm, fragment);
      else doc.transact(() => reconcile(doc, fragment, pm));
    }
    let blocks: NativeBlock[];
    try { blocks = pmBlocks(doc); } catch (error) { if (error instanceof EngineError) throw error; throw new EngineError("INVALID_CONTENT"); }
    const after = Y.encodeStateAsUpdate(doc);
    if (after.length > MAX_BINARY_BYTES) throw new EngineError("CONTENT_TOO_LARGE");
    return { state: encode(after), update: encode(Y.encodeStateAsUpdate(doc, vector)), state_vector: encode(Y.encodeStateVector(doc)), changed: !Buffer.from(before).equals(after), blocks };
  } finally { doc.destroy(); }
}
