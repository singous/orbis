import { act, render, screen, waitFor } from "@testing-library/react";
import { toast as heroToast } from "@heroui/react/toast";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { Link, MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { ActionButton } from "./ActionButton";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { NavItem, SectionLabel } from "./NavItem";
import { Tag } from "./Tag";
import { showToast, Toaster } from "./Toast";
import { Tooltip } from "./Tooltip";

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

describe("ActionButton", () => {
  it("preserves native help text on standard and feature buttons", () => {
    render(<><Button title="保存当前内容">保存</Button><ActionButton title="编辑名称和图标">编辑</ActionButton></>);
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("title", "保存当前内容");
    expect(screen.getByRole("button", { name: "编辑" })).toHaveAttribute("title", "编辑名称和图标");
  });

  it("keeps native button form submission for feature actions", async () => {
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const user = userEvent.setup();
    render(<form onSubmit={submit}><ActionButton>提交</ActionButton></form>);

    await user.click(screen.getByRole("button", { name: "提交" }));
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("IconButton", () => {
  it("exposes an accessible name", () => {
    render(<IconButton aria-label="更多操作">⋯</IconButton>);
    expect(screen.getByRole("button", { name: "更多操作" })).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("renders a controlled dialog without an orphaned press responder", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      render(<Dialog open onOpenChange={() => {}}><DialogContent title="编辑笔记本">内容</DialogContent></Dialog>);
      expect(screen.getByRole("dialog", { name: "编辑笔记本" })).toBeInTheDocument();
      expect(warning.mock.calls.some(([message]) => String(message).includes("PressResponder"))).toBe(false);
    } finally {
      warning.mockRestore();
    }
  });

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

describe("Toaster", () => {
  it("renders queued toasts and dismisses them", async () => {
    render(<Toaster />);

    act(() => {
      showToast({ title: "已保存", description: "文档内容已更新", tone: "success" });
    });

    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("文档内容已更新")).toBeInTheDocument();

    act(() => {
      heroToast.clear();
    });

    await waitFor(() => expect(screen.queryByText("已保存")).not.toBeInTheDocument());
  });
});

describe("Tooltip", () => {
  it("describes a navigation link without changing its link role", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Tooltip label="搜索文档"><Link to="/documents/search">搜索</Link></Tooltip></MemoryRouter>);

    const link = screen.getByRole("link", { name: "搜索" });
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument();
    await user.hover(link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("搜索文档");
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

it('preserves selected state for controls with tab and option roles', () => {
  const { rerender } = render(<ActionButton role="tab" aria-selected>Python</ActionButton>);
  expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true');
  rerender(<ActionButton role="option" aria-selected={false}>Paragraph</ActionButton>);
  expect(screen.getByRole('option', { name: 'Paragraph' })).toHaveAttribute('aria-selected', 'false');
});
