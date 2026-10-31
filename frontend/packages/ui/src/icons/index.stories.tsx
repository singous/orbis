import type { Meta, StoryObj } from "@storybook/react-vite";
import * as icons from "./index";

const meta = { title: "Primitives/Icons" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Catalog: Story = {
  render: () => <ul aria-label="界面图标" className="grid grid-cols-3 gap-4 md:grid-cols-6">{Object.entries(icons).map(([name, Icon]) => <li key={name} className="grid justify-items-center gap-2 text-ob-foreground"><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span className="text-xs">{name}</span></li>)}</ul>,
};
