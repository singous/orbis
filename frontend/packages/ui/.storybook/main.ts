import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { themeScopes } from "../../../scripts/theme-scopes";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  async viteFinal(config) {
    return { ...config, plugins: [...(config.plugins ?? []), tailwindcss({ optimize: false }), themeScopes()], resolve: { ...config.resolve, dedupe: ["react", "react-dom"] } };
  },
};
export default config;
