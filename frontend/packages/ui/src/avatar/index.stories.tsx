import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Avatar } from "./index";
const meta = { title: "Primitives/Avatar", component: Avatar, args: { fallback: "张" } } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Sizes: Story = { render: args => <div className="flex gap-3">{(["sm", "md", "lg"] as const).map(size => <Avatar {...args} key={size} size={size} />)}</div> };
export const FailedImage: Story = { args: { src: "data:image/png;base64,invalid" }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("张")).toBeVisible(); } };
