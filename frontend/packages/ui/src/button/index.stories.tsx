import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Button } from "./index";
import { Input } from "@orbis/ui/input";
import { cn } from "@orbis/ui/cn";

const meta = { title: "Primitives/Button", component: Button, args: { children: "保存", onClick: fn() } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Variants: Story = {
  render: () => <div className="flex flex-wrap gap-3">{(["primary", "secondary", "ghost", "danger"] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}<Button disabled>不可用</Button></div>,
};
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "保存" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    await expect(args.onClick).toHaveBeenCalledTimes(2);
  },
};
export const Loading: Story = {
  render: function LoadingExample(args) {
    const [loading, setLoading] = useState(false);
    return <><Button {...args} asChild={false} loading={loading} onClick={event => { args.onClick?.(event); setLoading(true); }}>{loading ? "保存中…" : "保存"}</Button><Button onClick={() => setLoading(false)}>完成</Button></>;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "保存" });
    await userEvent.click(button);
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).not.toHaveAttribute("disabled");
    await expect(button).not.toHaveAttribute("aria-busy");
    await expect(button).toHaveAccessibleName("保存中…");
    await userEvent.keyboard("{Enter} ");
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "完成" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(button).toHaveFocus();
  },
};
export const Composition: Story = {
  render: args => <Button {...args} asChild><button data-testid="composed">组合按钮</button></Button>,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "组合按钮" }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Dark: Story = { ...Variants, globals: { theme: "dark" } };

export const ComposedLoading: Story = {
  render: function ComposedLoadingExample(args) {
    const [loading, setLoading] = useState(false);
    return <Button asChild loading={loading} onClick={() => setLoading(true)}><button onClick={args.onClick}>{loading ? "保存中…" : "保存"}</button></Button>;
  },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "保存" });
    await userEvent.click(button);
    await expect(button).toHaveAccessibleName("保存中…");
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).not.toHaveAttribute("disabled");
    await expect(button.querySelector("[aria-hidden]")).toBeVisible();
    await userEvent.keyboard("{Enter} ");
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
export const ComposedAccessibleName: Story = {
  render: () => <Button asChild><button aria-label="编辑名称"><span aria-hidden="true">✎</span></button></Button>,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "编辑名称" });
    await expect(button).not.toHaveAttribute("aria-labelledby");
  },
};
export const StateStyles: Story = {
  render: () => <Button disabled className={state => state.disabled ? "text-base" : "text-sm"} style={state => ({ minWidth: state.disabled ? 120 : 80 })}>不可用</Button>,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "不可用" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveStyle({ minWidth: "120px", fontSize: "16px" });
  },
};

export const CallerOverrides: Story = {
  render: () => <div className="grid gap-3"><Button className="rounded-full">胶囊按钮</Button><label>胶囊输入<Input className="rounded-full" /></label></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const element of [canvas.getByRole("button", { name: "胶囊按钮" }), canvas.getByRole("textbox", { name: "胶囊输入" })]) {
      await expect(parseFloat(getComputedStyle(element).borderRadius)).toBeGreaterThanOrEqual(element.getBoundingClientRect().height / 2);
    }
    await expect(cn("rounded-full", "rounded-ob-lg")).toBe("rounded-ob-lg");
    await expect(cn("text-sm text-ob-foreground", "text-base")).toBe("text-ob-foreground text-base");
    await expect(cn("text-ob-foreground", "text-ob-primary")).toBe("text-ob-primary");
    await expect(cn("border border-ob-input", "border-2 border-ob-border")).toBe("border-2 border-ob-border");
    await expect(cn("bg-ob-card", "bg-ob-primary")).toBe("bg-ob-primary");
  },
};
