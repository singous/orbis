import { cpSync, mkdirSync } from "node:fs";

// Keep drawing fonts on the same origin in both Vite and deployed bundles.
const source = new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url);
const destination = new URL("../public/drawing-assets/", import.meta.url);
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
