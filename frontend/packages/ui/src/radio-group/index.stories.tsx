import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "./index";

function Example() { const [mode, setMode] = useState("light"); return <RadioGroup aria-label="外观" value={mode} onValueChange={setMode}><RadioGroupItem value="light">白天</RadioGroupItem><RadioGroupItem value="dark">夜间</RadioGroupItem><RadioGroupItem value="system">跟随系统</RadioGroupItem><RadioGroupItem value="locked" disabled>不可用</RadioGroupItem></RadioGroup>; }
const meta = { title: "Primitives/RadioGroup", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const light = canvas.getByRole("radio", { name: "白天" });
    light.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("radio", { name: "夜间" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("radio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowDown}");
    await expect(light).toHaveAttribute("aria-checked", "true");
  },
};
