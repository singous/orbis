import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Input } from "../input";
import { Field, FieldDescription, FieldError, FieldLabel } from "./index";

const meta = { title: "Brand/Field", component: Field } satisfies Meta<typeof Field>;
export default meta;

export const Invalid: StoryObj<typeof meta> = {
  render: () => (
    <Field invalid className="w-64">
      <FieldLabel>站点路径</FieldLabel>
      <Input defaultValue="team handbook" />
      <FieldDescription>使用小写英文、数字和连字符。</FieldDescription>
      <FieldError match>路径里不能有空格。</FieldError>
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "站点路径" });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("使用小写英文、数字和连字符。 路径里不能有空格。");
  },
};
