import { rmSync } from "node:fs";

// Workspaces upgraded from the retired editor may still contain generated fonts.
rmSync(new URL("../public/drawing-assets/", import.meta.url), {
  recursive: true,
  force: true,
});
