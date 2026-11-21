import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Button } from "../button";
import { ButtonGroup } from "./index";

const meta = { title: "Brand/ButtonGroup", component: ButtonGroup } satisfies Meta<typeof ButtonGroup>;
export default meta;

function Example() {
  const [preview, setPreview] = useState(false);
  return (
    <ButtonGroup aria-label="表单视图">
      <Button size="sm" variant={preview ? "ghost" : "secondary"} aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</Button>
      <Button size="sm" variant={preview ? "secondary" : "ghost"} aria-pressed={preview} onClick={() => setPreview(true)}>预览</Button>
    </ButtonGroup>
  );
}

export const ViewActions: StoryObj<typeof meta> = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole("group", { name: "表单视图" }));
    await userEvent.click(group.getByRole("button", { name: "预览" }));
    await expect(group.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "编辑" })).toHaveAttribute("aria-pressed", "false");
  },
};
