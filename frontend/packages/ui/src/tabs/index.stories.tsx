import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./index";
function Example() { return <Tabs defaultValue="one"><TabsList aria-label="内容"><TabsTrigger value="one">内容一</TabsTrigger><TabsTrigger value="two">内容二</TabsTrigger><TabsTrigger value="three" disabled>不可用</TabsTrigger></TabsList><TabsContent value="one">第一部分</TabsContent><TabsContent value="two">第二部分</TabsContent></Tabs>; }
const meta = { title: "Primitives/Tabs", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const first = canvas.getByRole("tab", { name: "内容一" });
  first.focus();
  await userEvent.keyboard("{ArrowRight}");
  const second = canvas.getByRole("tab", { name: "内容二" });
  await expect(second).toHaveFocus();
  await expect(canvas.getByRole("tabpanel", { name: "内容二" })).toHaveTextContent("第二部分");
  await userEvent.keyboard("{ArrowRight}");
  const disabled = canvas.getByRole("tab", { name: "不可用" });
  await expect(disabled).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect(canvas.getByRole("tabpanel", { name: "内容二" })).toBeVisible();
  await userEvent.keyboard("{ArrowRight}");
  await expect(first).toHaveFocus();
} };

export const Manual: Story = { render: () => <Tabs defaultValue="one"><TabsList aria-label="手动切换" activateOnFocus={false}><TabsTrigger value="one">内容一</TabsTrigger><TabsTrigger value="two">内容二</TabsTrigger></TabsList><TabsContent value="one">第一部分</TabsContent><TabsContent value="two">第二部分</TabsContent></Tabs>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  canvas.getByRole("tab", { name: "内容一" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect(canvas.getByRole("tab", { name: "内容二" })).toHaveFocus();
  await expect(canvas.getByRole("tabpanel", { name: "内容一" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect(canvas.getByRole("tabpanel", { name: "内容二" })).toBeVisible();
} };
