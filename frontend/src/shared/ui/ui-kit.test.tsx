import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "@orbis/ui/button";
import { EmptyState } from "./EmptyState";

it("renders an empty-state message with its real action", () => {
  render(<EmptyState title="还没有文档" description="新建一篇文档开始记录。" action={<Button size="sm">返回首页</Button>} />);
  expect(screen.getByText("还没有文档")).toBeInTheDocument();
  expect(screen.getByText("新建一篇文档开始记录。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回首页" })).toBeInTheDocument();
});
