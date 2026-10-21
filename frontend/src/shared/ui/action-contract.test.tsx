import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionButton } from "./ActionButton";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("shared action contract", () => {
  it("keeps ordinary controls inside forms from submitting and preserves explicit submit", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const action = vi.fn();
    const user = userEvent.setup();
    render(<form onSubmit={submit}>
      <Button onClick={action}>预览</Button>
      <ActionButton onClick={action}>展开</ActionButton>
      <IconButton aria-label="更多" onClick={action}>…</IconButton>
      <ActionButton type="submit">保存</ActionButton>
    </form>);
    for (const label of ["预览", "展开", "更多"]) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    expect(action).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("prevents pending actions from being repeated with pointer or keyboard", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(<><Button isPending onClick={action}>保存中</Button><ActionButton isPending onClick={action}>发布中</ActionButton></>);
    for (const label of ["保存中", "发布中"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-busy", "true");
      await user.click(button);
      button.focus();
      await user.keyboard("{Enter}");
    }
    expect(action).not.toHaveBeenCalled();
  });
});
