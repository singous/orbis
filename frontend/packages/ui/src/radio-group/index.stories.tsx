import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "./index";
function Example() { const [mode, setMode] = useState("light"); return <RadioGroup aria-label="外观" value={mode} onValueChange={setMode}>{[{ value: "light", label: "白天" }, { value: "dark", label: "夜间" }, { value: "system", label: "跟随系统" }, { value: "locked", label: "不可用" }].map(item => <div key={item.value} className="flex items-center gap-2"><RadioGroupItem id={`appearance-${item.value}`} value={item.value} disabled={item.value === "locked"} /><label htmlFor={`appearance-${item.value}`}>{item.label}</label></div>)}</RadioGroup>; }
const meta = { title: "Primitives/RadioGroup", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); const light = canvas.getByRole("radio", { name: "白天" }); light.focus(); await userEvent.keyboard("{ArrowDown}"); await expect(canvas.getByRole("radio", { name: "夜间" })).toHaveAttribute("aria-checked", "true"); await userEvent.keyboard("{ArrowDown}"); await expect(canvas.getByRole("radio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true"); await userEvent.keyboard("{ArrowDown}"); await expect(light).toHaveAttribute("aria-checked", "true"); } };
