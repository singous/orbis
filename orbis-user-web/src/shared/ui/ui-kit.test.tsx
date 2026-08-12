import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "./Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./DropdownMenu";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { NavItem, SectionLabel } from "./NavItem";
import { Tag } from "./Tag";
import { Toaster, useToastStore } from "./Toast";

describe("Button", () => {
  it("renders children and defaults to type=button", () => {
    render(<Button>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveAttribute("type", "button");
  });

  it("supports an explicit submit type", () => {
    render(<Button type="submit">登录</Button>);
    expect(screen.getByRole("button", { name: "登录" })).toHaveAttribute("type", "submit");
  });

  it("blocks interaction when disabled", async () => {
    const user = userEvent.setup();
    let clicked = 0;
    render(
      <Button disabled onClick={() => (clicked += 1)}>
        删除
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(clicked).toBe(0);
  });
});

describe("IconButton", () => {
  it("exposes an accessible name", () => {
    render(<IconButton aria-label="更多操作">⋯</IconButton>);
    expect(screen.getByRole("button", { name: "更多操作" })).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("opens from a trigger and closes with the close button", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>新建文档</Button>
        </DialogTrigger>
        <DialogContent title="新建文档" description="输入文档标题">
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="primary">创建</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建文档" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("输入文档标题");

    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DropdownMenu", () => {
  it("opens from the trigger and lists items", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label="文档操作">⋯</IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>重命名</DropdownMenuItem>
          <DropdownMenuItem destructive>删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文档操作" }));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });
});

describe("Toaster", () => {
  it("renders queued toasts and dismisses them", () => {
    render(<Toaster />);

    act(() => {
      useToastStore.getState().push({ title: "已保存", description: "文档内容已更新", tone: "success" });
    });

    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("文档内容已更新")).toBeInTheDocument();

    act(() => {
      const { toasts, dismiss } = useToastStore.getState();
      dismiss(toasts[0].id);
    });

    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(
      <EmptyState
        title="知识库正在建设中"
        description="该能力即将上线，敬请期待。"
        action={<Button size="sm">返回首页</Button>}
      />,
    );

    expect(screen.getByText("知识库正在建设中")).toBeInTheDocument();
    expect(screen.getByText("该能力即将上线，敬请期待。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回首页" })).toBeInTheDocument();
  });
});

describe("Tag", () => {
  it("renders its content", () => {
    render(<Tag tone="accent">即将上线</Tag>);
    expect(screen.getByText("即将上线")).toBeInTheDocument();
  });
});

describe("NavItem", () => {
  it("renders a navigation link with label and badge", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <SectionLabel>能力</SectionLabel>
        <NavItem to="/knowledge" badge={<Tag tone="accent">即将上线</Tag>}>
          知识库
        </NavItem>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /知识库/ })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByText("能力")).toBeInTheDocument();
    expect(screen.getByText("即将上线")).toBeInTheDocument();
  });
});
