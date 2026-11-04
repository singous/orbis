import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./index";
const meta = { title: "Primitives/Skeleton", component: Skeleton } satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { render: () => <div className="grid gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-3 w-72" /><Skeleton className="h-3 w-56 animate-none" /></div> };
