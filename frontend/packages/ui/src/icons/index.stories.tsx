import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import * as icons from "./index";

const meta = { title: "Primitives/Icons" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Catalog: Story = {
  render: () => <ul aria-label="界面图标" className="grid grid-cols-3 gap-4 md:grid-cols-6">{Object.entries(icons).map(([name, Icon]) => <li key={name} className="grid min-w-0 justify-items-center gap-2 text-ob-foreground"><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span className="min-w-0 max-w-full text-center text-ob-caption wrap-anywhere">{name}</span></li>)}</ul>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("list", { name: "界面图标" });
    const bounds = list.getBoundingClientRect();
    for (const item of canvas.getAllByRole("listitem")) {
      const caption = item.querySelector("span")!;
      const box = caption.getBoundingClientRect();
      await expect(box.width).toBeGreaterThan(0);
      await expect(box.left).toBeGreaterThanOrEqual(bounds.left);
      await expect(box.right).toBeLessThanOrEqual(bounds.right);
      await expect(caption.scrollWidth).toBeLessThanOrEqual(caption.clientWidth);
    }
  },
};
