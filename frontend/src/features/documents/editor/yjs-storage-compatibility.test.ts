import { describe, expect, it } from "vitest";
import * as Y from "yjs";

/** Executable architecture probes, not an Orbis collaboration provider. */
function seed(text = "Base") {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph"), body = new Y.XmlText();
  paragraph.setAttribute("blockId", "stable-orbis-block");
  body.insert(0, text);
  paragraph.insert(0, [body]);
  doc.getXmlFragment("body").insert(0, [paragraph]);
  return doc;
}
function body(doc: Y.Doc) { return (doc.getXmlFragment("body").get(0) as Y.XmlElement).get(0) as Y.XmlText; }

describe("Yjs persistence route for independent block projections", () => {
  it("merges concurrent rich-text edits and reconnects after binary persistence", () => {
    const initial = seed(), baseline = Y.encodeStateAsUpdate(initial);
    const a = new Y.Doc(), b = new Y.Doc();
    Y.applyUpdate(a, baseline); Y.applyUpdate(b, baseline);
    const updates: Uint8Array[] = [];
    a.on("update", update => updates.push(update)); b.on("update", update => updates.push(update));
    a.transact(() => body(a).insert(4, " A"));
    b.transact(() => { body(b).format(0, 4, { bold: true }); body(b).insert(4, " B"); });
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.mergeUpdates([baseline, ...updates, ...updates.reverse()]));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(restored)); Y.applyUpdate(b, Y.encodeStateAsUpdate(restored));
    expect(body(a).toString()).toBe(body(b).toString());
    expect(body(restored).toString()).toContain(" A");
    expect(body(restored).toString()).toContain(" B");
    expect(body(restored).toDelta().some((run: { attributes?: { bold?: boolean } }) => run.attributes?.bold === true)).toBe(true);
    expect((restored.getXmlFragment("body").get(0) as Y.XmlElement).getAttribute("blockId")).toBe("stable-orbis-block");
    b.transact(() => body(b).insert(body(b).length, " after reconnect"));
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(b, Y.encodeStateVector(restored)));
    expect(body(restored).toString()).toBe(body(b).toString());
    expect(restored.getXmlFragment("body").length).toBe(1);
  });

  it("shows why JSON reseeding cannot replace persisted CRDT identity", () => {
    const original = seed();
    const jsonRebuilt = seed(body(original).toString());
    Y.applyUpdate(jsonRebuilt, Y.encodeStateAsUpdate(original));
    expect(jsonRebuilt.getXmlFragment("body").length).toBe(2);
    const binaryRestored = new Y.Doc();
    Y.applyUpdate(binaryRestored, Y.encodeStateAsUpdate(original));
    Y.applyUpdate(binaryRestored, Y.encodeStateAsUpdate(original));
    expect(binaryRestored.getXmlFragment("body").length).toBe(1);
  });

  it("keeps a subdocument body unloaded until a provider explicitly supplies it", () => {
    const root = new Y.Doc(), partition = seed("Deferred rich text");
    root.getMap<Y.Doc>("partitions").set("section-1", partition);
    const persistedBody = Y.encodeStateAsUpdate(partition);
    const reconnected = new Y.Doc();
    Y.applyUpdate(reconnected, Y.encodeStateAsUpdate(root));
    const unloaded = reconnected.getMap<Y.Doc>("partitions").get("section-1")!;
    expect(unloaded.getXmlFragment("body").length).toBe(0);
    const requested = new Set<Y.Doc>();
    reconnected.on("subdocs", ({ loaded }) => { for (const doc of loaded) requested.add(doc); });
    unloaded.load();
    expect(requested.has(unloaded)).toBe(true);
    // A real provider must authenticate this subscription, retrieve the binary
    // snapshot/updates and apply them; the root descriptor alone has no body.
    Y.applyUpdate(unloaded, persistedBody);
    expect(body(unloaded).toString()).toBe("Deferred rich text");
    expect(unloaded.guid).toBe(partition.guid);
  });
});
