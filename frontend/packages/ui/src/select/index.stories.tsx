import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Select } from "./index";

function EmptyValue() {
  const [value, setValue] = useState<string | null>("name");
  return <Select label="分组" value={value} onValueChange={setValue} options={[{ value: "", label: "不分组" }, { value: "name", label: "名称" }]} />;
}
const meta = { title: "Primitives/Select", component: EmptyValue } satisfies Meta<typeof EmptyValue>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyString: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole("combobox", { name: "分组" });
    await userEvent.click(select);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "不分组" }));
    await expect(select).toHaveTextContent("不分组");
    await waitFor(() => expect(select).toHaveFocus());
  },
};
export const Zero: Story = { render: () => <Select label="数量" defaultValue={0} options={[{ value: 0, label: "零" }, { value: 1, label: "一" }]} /> };

export const DescriptionAndDensity: Story = {
  render: () => <div className="grid gap-4"><p id="select-help">外部说明。</p>{(["compact", "default", "form"] as const).map(density => <Select key={density} label={density} density={density} options={[{ value: 0, label: "零" }]} defaultValue={0} description="选择一个数字。" aria-describedby="select-help" wrapperClassName="max-w-80" className={state => state.value === 0 ? "font-medium" : "font-normal"} style={state => ({ minWidth: state.value === 0 ? 120 : 80 })} />)}</div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const [density, height] of [["compact", 32], ["default", 36], ["form", 40]] as const) {
      const select = canvas.getByRole("combobox", { name: density });
      await expect(select).toHaveAccessibleDescription("外部说明。 选择一个数字。");
      await expect(select).toHaveStyle({ minWidth: "120px" });
      await expect(select.getBoundingClientRect().height).toBe(height);
      await expect(select.parentElement).toHaveClass("max-w-80");
    }
  },
};
