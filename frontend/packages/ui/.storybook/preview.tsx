import type { Preview } from "@storybook/react-vite";
import { OverlayScopeProvider } from "../src/internal/overlay-scope";
import "./styles.css";

const preview: Preview = {
  globalTypes: { theme: { description: "主题", toolbar: { icon: "circlehollow", items: ["light", "dark"] } } },
  initialGlobals: { theme: "light" },
  parameters: { a11y: { test: "error" }, layout: "padded" },
  decorators: [(Story, context) => <OverlayScopeProvider value={{ "data-theme": context.globals.theme, className: context.globals.theme === "dark" ? "dark" : undefined }}><div data-theme={context.globals.theme} className="min-h-48 bg-background p-6 font-sans text-sm text-foreground"><Story /></div></OverlayScopeProvider>],
};
export default preview;
