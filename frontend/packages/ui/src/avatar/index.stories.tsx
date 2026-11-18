import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Avatar, AvatarImage, AvatarFallback } from "./index";
const meta = { title: "Primitives/Avatar", component: Avatar } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Sizes: Story = { render: () => <div className="flex gap-3">{(["sm", "default", "lg"] as const).map(size => <Avatar key={size} size={size}><AvatarFallback>张</AvatarFallback></Avatar>)}</div> };
export const FailedImage: Story = { render: () => <Avatar><AvatarImage src="data:image/png;base64,invalid" alt="张的头像" /><AvatarFallback>张</AvatarFallback></Avatar>, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("张")).toBeVisible(); } };
