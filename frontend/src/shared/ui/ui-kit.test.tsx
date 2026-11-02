import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { Button } from "@orbis/ui/button";
import { Badge } from "@orbis/ui/badge";
import { EmptyState } from "./EmptyState";
import { NavItem, SectionLabel } from "./NavItem";

it("renders an empty-state message with its real action", () => {
  render(<EmptyState title="还没有文档" description="新建一篇文档开始记录。" action={<Button size="sm">返回首页</Button>} />);
  expect(screen.getByText("还没有文档")).toBeInTheDocument();
  expect(screen.getByText("新建一篇文档开始记录。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回首页" })).toBeInTheDocument();
});

it("renders navigation with a native badge without changing link semantics", () => {
  render(<MemoryRouter initialEntries={["/home"]}>
    <SectionLabel>内容</SectionLabel>
    <NavItem to="/sites" badge={<Badge variant="secondary">已发布</Badge>}>站点</NavItem>
  </MemoryRouter>);
  expect(screen.getByRole("link", { name: /站点/ })).toHaveAttribute("href", "/sites");
  expect(screen.getByText("内容")).toBeInTheDocument();
  expect(screen.getByText("已发布")).toBeInTheDocument();
});
