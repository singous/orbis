// Generate the editor/reader contract from the API's declarative block schema.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../../orbis-user-api/src/orbis_user_api/domain/document_blocks.json", import.meta.url);
const target = new URL("../src/features/content/document-blocks.json", import.meta.url);
const canonical = JSON.stringify(JSON.parse(await readFile(source, "utf8")), null, 2) + "\n";
if (process.argv.includes("--check")) {
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing !== canonical) {
    throw new Error("Document block contract is out of date. Run node scripts/sync-document-blocks.mjs.");
  }
} else {
  await mkdir(fileURLToPath(new URL("../src/features/content/", import.meta.url)), { recursive: true });
  await writeFile(target, canonical);
}
