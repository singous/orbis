import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./index";

const meta = { title: "Brand/InputGroup", component: InputGroup } satisfies Meta<typeof InputGroup>;
export default meta;

export const SearchField: StoryObj<typeof meta> = {
  render: () => (
    <InputGroup className="w-64">
      <InputGroupAddon aria-hidden="true"><Search size={16} /></InputGroupAddon>
      <InputGroupInput type="search" aria-label="搜索文档" placeholder="输入关键词" />
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole("searchbox", { name: "搜索文档" });
    await userEvent.tab();
    await expect(field).toHaveFocus();
    await userEvent.type(field, "Orbis");
    await expect(field).toHaveValue("Orbis");
  },
};
