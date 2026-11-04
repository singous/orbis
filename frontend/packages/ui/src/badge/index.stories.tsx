import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./index";
const meta = { title: "Primitives/Badge", component: Badge } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Variants: Story = { render: () => <div className="flex flex-wrap gap-3">{(["default", "secondary", "destructive", "outline", "ghost", "link"] as const).map(variant => <Badge key={variant} variant={variant}>{variant}</Badge>)}</div> };
export const Dark: Story = { ...Variants, globals: { theme: "dark" } };
