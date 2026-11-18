import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, fireEvent, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { ColorPicker } from "./index";

function Example({ disabled = false, onChange, onEnd }: { disabled?: boolean; onChange: (value: string) => void; onEnd: (value: string) => void }) {
  const [value, setValue] = useState("#FF0000");
  return <div className="w-60"><ColorPicker value={value} disabled={disabled} onValueChange={color => { setValue(color); onChange(color); }} onValueChangeEnd={onEnd} /></div>;
}
const meta = { title: "Primitives/ColorPicker", component: Example, args: { onChange: fn(), onEnd: fn() } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeyboardCommit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const area = canvas.getByRole("slider", { name: "饱和度与亮度" });
    await expect(area).toHaveAttribute("aria-valuetext", "饱和度 100%，亮度 100%");
    const hue = canvas.getByRole("slider", { name: "色相" });
    hue.focus();
    // 固定库版本使用 legacy keyCode；这些是原生 ArrowRight 的实际事件值。
    fireEvent.keyDown(hue, { key: "ArrowRight", keyCode: 39, which: 39 });
    await waitFor(() => expect(args.onChange).toHaveBeenCalledTimes(1));
    await expect(args.onEnd).not.toHaveBeenCalled();
    fireEvent.keyUp(hue, { key: "ArrowRight", keyCode: 39, which: 39 });
    await waitFor(() => expect(args.onEnd).toHaveBeenCalledWith(args.onChange.mock.calls[0][0]));
  },
};
export const PointerCommit: Story = {
  play: async ({ canvasElement, args }) => {
    const actor = userEvent.setup();
    const area = within(canvasElement).getByRole("slider", { name: "饱和度与亮度" });
    const bounds = area.getBoundingClientRect();
    await actor.pointer([{ target: area, keys: "[MouseLeft>]", coords: { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 } }]);
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
    await expect(args.onEnd).not.toHaveBeenCalled();
    await actor.pointer([{ target: area, keys: "[/MouseLeft]" }]);
    await waitFor(() => expect(args.onEnd).toHaveBeenCalledTimes(1));
  },
};
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("group", { name: "颜色选择器" })).toHaveAttribute("aria-disabled", "true");
    for (const slider of canvas.getAllByRole("slider")) await expect(slider).toHaveAttribute("tabindex", "-1");
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
