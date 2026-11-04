import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useId, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./index";

const grouping = [{ value: "", label: "不分组" }, { value: "name", label: "按名称" }];
function Example() {
  const [value, setValue] = useState<string | null>("");
  const id = useId();
  return <div className="grid gap-2"><label id={id}>分组方式</label><Select items={grouping} value={value} onValueChange={setValue}><SelectTrigger aria-labelledby={id}><SelectValue /></SelectTrigger><SelectContent>{grouping.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>;
}
const meta = { title: "Primitives/Select", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyString: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body); const trigger = canvas.getByRole("combobox", { name: "分组方式" }); await expect(trigger).toHaveTextContent("不分组"); await userEvent.click(trigger); await userEvent.click(await screen.findByRole("option", { name: "按名称" })); await expect(trigger).toHaveTextContent("按名称"); await userEvent.click(trigger); await userEvent.click(await screen.findByRole("option", { name: "不分组" })); await expect(trigger).toHaveTextContent("不分组"); } };
export const Zero: Story = { render: () => <Select items={[{ value: 0, label: "零" }, { value: 1, label: "一" }]} defaultValue={0}><SelectTrigger aria-label="数量"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={0}>零</SelectItem><SelectItem value={1}>一</SelectItem></SelectContent></Select> };
export const LabeledItems: Story = { render: () => <div className="grid gap-4"><p id="select-help">选择一个数字。</p>{(["sm", "default"] as const).map(size => <div key={size} className="grid gap-2"><label id={`size-${size}`}>{size}</label><Select items={[{ value: 0, label: "零" }, { value: 1, label: "一" }]} defaultValue={0}><SelectTrigger size={size} aria-labelledby={`size-${size}`} aria-describedby="select-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={0}>零</SelectItem><SelectItem value={1}>一</SelectItem></SelectContent></Select></div>)}</div>, play: async ({ canvasElement }) => { const canvas = within(canvasElement); for (const name of ["sm", "default"]) { const control = canvas.getByRole("combobox", { name }); await expect(control).toHaveTextContent("零"); await expect(control).toHaveAccessibleDescription("选择一个数字。"); } } };
