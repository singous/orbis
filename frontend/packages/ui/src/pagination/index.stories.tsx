import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Pagination } from "./index";

const meta = { title: "Brand/Pagination", component: Pagination } satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof Example>;

function Example() {
  const [page, setPage] = useState(1);
  return (
    <Pagination
      label="文档分页"
      hasPrevious={page > 1}
      hasNext={page < 2}
      onPrevious={() => setPage(page - 1)}
      onNext={() => setPage(page + 1)}
    >第 {page} / 2 页</Pagination>
  );
}

export const PageBoundaries: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const navigation = within(within(canvasElement).getByRole("navigation", { name: "文档分页" }));
    await expect(navigation.getByRole("button", { name: "上一页" })).toBeDisabled();
    await userEvent.click(navigation.getByRole("button", { name: "下一页" }));
    await expect(navigation.getByText("第 2 / 2 页")).toBeVisible();
    await expect(navigation.getByRole("button", { name: "下一页" })).toBeDisabled();
    await userEvent.click(navigation.getByRole("button", { name: "上一页" }));
    await expect(navigation.getByText("第 1 / 2 页")).toBeVisible();
  },
};
