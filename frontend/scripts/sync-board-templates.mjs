import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const target = new URL("../../api/board-templates.json", import.meta.url);
const result = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/features/boards/templates.ts", import.meta.url),
    ),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { TEMPLATES } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
const page = "00000000-0000-4000-8000-000000000001";
function identity(key) {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
const templates = TEMPLATES.map((template) => {
  const elements = template.build(page),
    ids = new Map();
  elements.forEach((e, i) => {
    ids.set(e.id, identity(template.id + ":element:" + i));
    e.structure.members.forEach((m, j) =>
      ids.set(m.id, identity(template.id + ":member:" + i + ":" + j)),
    );
  });
  for (const e of elements) {
    e.id = ids.get(e.id);
    if (e.structure.parent_id)
      e.structure.parent_id = ids.get(e.structure.parent_id);
    for (const m of e.structure.members) m.id = ids.get(m.id);
    for (const endpoint of [e.structure.start, e.structure.end])
      if (endpoint) {
        if (endpoint.element_id)
          endpoint.element_id = ids.get(endpoint.element_id);
        const [side, member] = endpoint.port.split(":");
        if (ids.has(member)) endpoint.port = side + ":" + ids.get(member);
      }
  }
  return {
    id: template.id,
    version: 1,
    name: template.name,
    category: template.category,
    description: template.description,
    elements,
  };
});
const canonical =
  JSON.stringify({ schema_version: 1, templates }, null, 2) + "\n";
if (process.argv.includes("--write")) await writeFile(target, canonical);
else if ((await readFile(target, "utf8").catch(() => "")) !== canonical)
  throw new Error(
    "Board templates differ from the API contract. Run npm run sync:board-templates.",
  );
console.log("Verified " + templates.length + " versioned board templates.");
