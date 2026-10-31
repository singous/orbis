import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./index";
const meta = { title: "Primitives/Badge", component: Badge } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Tones: Story = { render: () => <div className="flex gap-3">{(["neutral", "accent", "success", "warning", "danger"] as const).map(tone => <Badge key={tone} tone={tone}>{tone}</Badge>)}</div> };

export const Dark: Story = { ...Tones, globals: { theme: "dark" } };
