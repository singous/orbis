import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../src/shared/ui/Button";
import { ActionButton } from "../../src/shared/ui/ActionButton";
import userEvent from "@testing-library/user-event";
import { LoadingState } from "../../src/shared/ui/LoadingState";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("loading feedback", () => {
  it.each(["cards", "rows", "editor"] as const)("reserves a %s layout with one accessible loading announcement", variant => {
    const view = render(<LoadingState label="正在加载文档…" variant={variant} />);
    expect(screen.getByRole("status", { name: "正在加载文档…" })).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelectorAll('.skeleton').length).toBeGreaterThan(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
  it("delays the editor body placeholder and omits the document title placeholder", () => {
    vi.useFakeTimers();
    const view = render(<LoadingState label="正在准备编辑…" variant="editor-body" delayMs={180} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { vi.advanceTimersByTime(180); });
    expect(screen.getByRole("status", { name: "正在准备编辑…" })).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelectorAll('.skeleton')).toHaveLength(4);
    expect(view.container.querySelector('.loading-layout--editor')).toBeNull();
  });

});

describe("pending actions", () => {
  it.each([Button, ActionButton])("shows a pending indicator and suppresses duplicate activation", async Control => {
    const action = vi.fn();
    const actor = userEvent.setup();
    const view = render(<Control isPending onPress={action}>保存</Control>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelector('.spinner')).toBeInTheDocument();
    await actor.click(button);
    expect(action).not.toHaveBeenCalled();
    view.rerender(<Control onPress={action}>保存</Control>);
    await actor.click(screen.getByRole("button", { name: "保存" }));
    expect(action).toHaveBeenCalledOnce();
  });
});
