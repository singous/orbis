import type { Preview } from "@storybook/react-vite";
import "./styles.css";

const preview: Preview = {
  globalTypes: { theme: { description: "主题", toolbar: { icon: "circlehollow", items: ["light", "dark"] } } },
  initialGlobals: { theme: "light" },
  parameters: { a11y: { test: "error" }, layout: "padded" },
  decorators: [(Story, context) => <div data-theme={context.globals.theme} className="min-h-48 bg-ob-background p-6 font-ob-sans text-sm text-ob-foreground"><Story /></div>],
};
export default preview;
