import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Button } from "./index";
import { Input } from "@orbis/ui/input";
import { Spinner } from "@orbis/ui/spinner";
import { cn } from "@orbis/ui/cn";

const meta = { title: "Primitives/Button", component: Button, args: { children: "保存", onClick: fn() } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Variants: Story = { render: () => <div className="flex flex-wrap gap-3">{(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}<Button disabled>不可用</Button></div> };
export const Keyboard: Story = { play: async ({ canvasElement, args }) => {
  const button = within(canvasElement).getByRole("button", { name: "保存" });
  button.focus(); await userEvent.keyboard("{Enter}"); await userEvent.keyboard(" ");
  await expect(args.onClick).toHaveBeenCalledTimes(2);
} };
export const Loading: Story = {
  render: function LoadingExample(args) {
    const [pending, setPending] = useState(false);
    return <div className="flex gap-3"><Button {...args} disabled={pending} focusableWhenDisabled={pending} aria-busy={pending || undefined} onClick={event => { args.onClick?.(event); setPending(true); }}>{pending ? <Spinner aria-hidden="true" /> : null}{pending ? "保存中…" : "保存"}</Button><Button onClick={() => setPending(false)}>完成</Button></div>;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement), button = canvas.getByRole("button", { name: "保存" });
    await userEvent.click(button);
    await expect(button).toHaveFocus(); await expect(button).toHaveAttribute("aria-disabled", "true"); await expect(button).not.toHaveAttribute("disabled"); await expect(button).toHaveAttribute("aria-busy", "true"); await expect(button).toHaveAccessibleName("保存中…");
    await userEvent.keyboard("{Enter} "); await expect(args.onClick).toHaveBeenCalledTimes(1);
    await userEvent.tab(); await expect(canvas.getByRole("button", { name: "完成" })).toHaveFocus();
    await userEvent.tab({ shift: true }); await expect(button).toHaveFocus();
  },
};
export const Composition: Story = { render: args => <Button {...args} render={<button data-testid="composed" />}>组合按钮</Button>, play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement); await expect(canvas.getAllByRole("button")).toHaveLength(1); await userEvent.click(canvas.getByRole("button", { name: "组合按钮" })); await expect(args.onClick).toHaveBeenCalledTimes(1);
} };
export const Dark: Story = { ...Variants, globals: { theme: "dark" } };
export const ComposedLoading: Story = {
  render: function ComposedLoadingExample(args) {
    const [pending, setPending] = useState(false);
    return <Button render={<button onClick={args.onClick} />} disabled={pending} focusableWhenDisabled={pending} aria-busy={pending || undefined} onClick={() => setPending(true)}>{pending ? <Spinner aria-hidden="true" /> : null}{pending ? "保存中…" : "保存"}</Button>;
  },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "保存" }); await userEvent.click(button);
    await expect(button).toHaveAccessibleName("保存中…"); await expect(button).toHaveFocus(); await expect(button).toHaveAttribute("aria-disabled", "true"); await expect(button).not.toHaveAttribute("disabled"); await expect(button.querySelector('[aria-hidden]')).toBeVisible();
    await userEvent.keyboard("{Enter} "); await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
export const ComposedAccessibleName: Story = { render: () => <Button render={<button aria-label="编辑名称" />}><span aria-hidden="true">✎</span></Button>, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByRole("button", { name: "编辑名称" })).not.toHaveAttribute("aria-labelledby"); } };
export const StateStyles: Story = { render: () => <Button disabled className="data-disabled:text-base" style={{ minWidth: 120 }}>不可用</Button>, play: async ({ canvasElement }) => { const button = within(canvasElement).getByRole("button", { name: "不可用" }); await expect(button).toBeDisabled(); await expect(button).toHaveStyle({ minWidth: "120px", fontSize: "16px" }); } };
export const CallerOverrides: Story = { render: () => <div className="grid gap-3"><Button className="rounded-full">胶囊按钮</Button><label>胶囊输入<Input className="rounded-full" /></label></div>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); for (const element of [canvas.getByRole("button", { name: "胶囊按钮" }), canvas.getByRole("textbox", { name: "胶囊输入" })]) await expect(parseFloat(getComputedStyle(element).borderRadius)).toBeGreaterThanOrEqual(element.getBoundingClientRect().height / 2);
  await expect(cn("rounded-full", "rounded-lg")).toBe("rounded-lg"); await expect(cn("text-sm text-foreground", "text-base")).toBe("text-foreground text-base");
} };
export const NativeChildren: Story = { render: args => <Button {...args} aria-label="连接点" size="icon"><svg data-testid="direct-icon" aria-hidden="true" width="10" height="10"><path d="M0 5h10M5 0v10" /></svg></Button>, play: async ({ canvasElement, args }) => { const button = within(canvasElement).getByRole("button", { name: "连接点" }); await expect(button.firstElementChild).toBe(within(button).getByTestId("direct-icon")); button.focus(); await userEvent.keyboard("{Enter}"); await expect(args.onClick).toHaveBeenCalledTimes(1); } };
export const DangerHover: Story = { render: () => <Button variant="destructive">危险动作</Button>, play: async ({ canvasElement }) => { const button = within(canvasElement).getByRole("button", { name: "危险动作" }); await userEvent.hover(button); await Promise.all(button.getAnimations().map(animation => animation.finished)); } };
export const DarkDangerHover: Story = { ...DangerHover, globals: { theme: "dark" } };
