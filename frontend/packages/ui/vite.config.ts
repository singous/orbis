import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

export default defineConfig({
  optimizeDeps: { include: ["react/jsx-dev-runtime", "@base-ui/react/button", "@base-ui/react/input", "@base-ui/react/dialog", "@base-ui/react/select", "@base-ui/react/avatar"] },
  plugins: [storybookTest({ configDir: fileURLToPath(new URL("./.storybook", import.meta.url)) })],
  test: {
    name: "ui-stories",
    browser: { enabled: true, headless: true, provider: "playwright", instances: [{ browser: "chromium" }] },
    setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
  },
});
