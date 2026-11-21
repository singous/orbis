import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen } from "lucide-react";
import { Button } from "../button";
import { Empty } from "./index";

const meta = { title: "Brand/Empty", component: Empty } satisfies Meta<typeof Empty>;
export default meta;

export const Initial: StoryObj<typeof meta> = {
  args: {
    icon: <FolderOpen size={20} />,
    title: "这里还没有文档",
    description: "创建一篇文档，开始记录。",
    action: <Button>新建文档</Button>,
  },
};
