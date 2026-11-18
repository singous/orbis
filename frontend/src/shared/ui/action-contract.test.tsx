import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@orbis/ui/button";

// 表单动作保持原生 type 语义，异步动作不能因为仍可聚焦而重复执行。
describe("native action contract", () => {
  it("keeps ordinary form controls separate from explicit submission", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const action = vi.fn();
    const user = userEvent.setup();
    render(<form onSubmit={submit}>
      <Button onClick={action}>预览</Button>
      <Button variant="ghost" onClick={action}>展开</Button>
      <Button size="icon" aria-label="更多" onClick={action}>…</Button>
      <Button type="submit">保存</Button>
    </form>);
    for (const label of ["预览", "展开", "更多"]) await user.click(screen.getByRole("button", { name: label }));
    expect(action).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("blocks repeated pointer and keyboard activation while a pending action retains focus", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(<Button disabled focusableWhenDisabled aria-busy onClick={action}>保存中</Button>);
    const button = screen.getByRole("button", { name: "保存中" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    button.focus();
    await user.keyboard("{Enter} ");
    await user.click(button);
    expect(action).not.toHaveBeenCalled();
  });
});
