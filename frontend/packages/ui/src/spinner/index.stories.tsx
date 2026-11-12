import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./index";
const meta = { title: "Primitives/Spinner", component: Spinner } satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { render: () => <div className="flex gap-4"><Spinner /><Spinner className="size-3" aria-label="正在读取" /></div> };
