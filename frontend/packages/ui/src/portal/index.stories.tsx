import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Toolbar } from "@orbis/ui/toolbar";
import { Portal, readPortalTheme } from "./index";

function StableHost() {
  const [host] = useState(() => document.createElement("div"));
  const landing = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [custom, setCustom] = useState(false);
  useLayoutEffect(() => { (expanded ? document.body : landing.current!).append(host); }, [expanded, host]);
  useLayoutEffect(() => () => host.remove(), [host]);
  return <div data-testid="portal-source" data-theme={theme} style={{ "--ob-primary": custom ? "#abcdef" : "#123456" } as CSSProperties}>
    <div className="mb-3 flex flex-wrap gap-2">
      <Button onClick={() => setExpanded(value => !value)}>{expanded ? "收回宿主" : "移动到 body"}</Button>
      <Button onClick={() => setTheme(value => value === "light" ? "dark" : "light")}>切换局部主题</Button>
      <Button onClick={() => setCustom(value => !value)}>切换局部颜色</Button>
    </div>
    <div ref={landing} />
    <Portal container={host}><div data-testid="portal-colors" className="bg-ob-background p-3 text-ob-primary"><label className="grid gap-2">保留的草稿<Input defaultValue="草稿" /></label></div></Portal>
  </div>;
}

function EmptyTarget() {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.dataset.testid = "portal-empty-target";
    element.className = "empty:hidden";
    return element;
  });
  const landing = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => { landing.current!.append(host); return () => host.remove(); }, [host]);
  return <><Button onClick={() => setVisible(value => !value)}>切换目标内容</Button><div ref={landing} /><Portal container={host}>{visible ? <p>目标内容</p> : null}</Portal></>;
}

function ToolbarPortal() {
  return <Toolbar aria-label="源工具栏"><Portal container={document.body}><div className="flex gap-2"><Button>浮层保存</Button><Button>浮层取消</Button></div></Portal><Button>源操作</Button></Toolbar>;
}

const meta = { title: "Primitives/Portal", component: StableHost } satisfies Meta<typeof StableHost>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StableHostAndScope: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const source = canvas.getByTestId("portal-source");
    const probe = screen.getByTestId("portal-colors");
    const wrapper = probe.closest('[data-slot="ob-portal"]')!;
    const input = screen.getByRole("textbox", { name: "保留的草稿" });
    const lightBackground = getComputedStyle(probe).backgroundColor;
    await expect(getComputedStyle(wrapper).display).toBe("contents");
    await expect(getComputedStyle(probe).color).toBe("rgb(18, 52, 86)");
    await userEvent.type(input, "仍在编辑");
    const draft = (input as HTMLInputElement).value;
    await userEvent.click(canvas.getByRole("button", { name: "移动到 body" }));
    await expect(screen.getByRole("textbox", { name: "保留的草稿" })).toBe(input);
    await expect(input).toHaveValue(draft);
    await expect(canvasElement.contains(input)).toBe(false);
    await userEvent.click(canvas.getByRole("button", { name: "切换局部主题" }));
    await waitFor(() => expect(wrapper).toHaveAttribute("data-theme", "dark"));
    await waitFor(() => expect(getComputedStyle(probe).backgroundColor).not.toBe(lightBackground));
    await userEvent.click(canvas.getByRole("button", { name: "切换局部颜色" }));
    await waitFor(() => expect(getComputedStyle(probe).color).toBe("rgb(171, 205, 239)"));
    await expect(readPortalTheme(source)).toMatchObject({ theme: "dark", portalStyle: { "--ob-primary": "#abcdef" } });
    await userEvent.click(canvas.getByRole("button", { name: "收回宿主" }));
    await expect(canvas.getByRole("textbox", { name: "保留的草稿" })).toBe(input);
    await expect(input).toHaveValue(draft);
  },
};

export const EmptyContent: Story = {
  render: () => <EmptyTarget />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const target = canvas.getByTestId("portal-empty-target");
    await expect(target).toBeEmptyDOMElement();
    await expect(getComputedStyle(target).display).toBe("none");
    await userEvent.click(canvas.getByRole("button", { name: "切换目标内容" }));
    await expect(within(target).getByText("目标内容")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "切换目标内容" }));
    await expect(target).toBeEmptyDOMElement();
    await expect(getComputedStyle(target).display).toBe("none");
  },
};

export const ToolbarIsolation: Story = {
  render: () => <ToolbarPortal />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const save = screen.getByRole("button", { name: "浮层保存" });
    save.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(save).toHaveFocus();
    await userEvent.tab();
    await expect(screen.getByRole("button", { name: "浮层取消" })).toHaveFocus();
  },
};
