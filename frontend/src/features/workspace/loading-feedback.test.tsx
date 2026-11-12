import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadingState } from "../../shared/ui/LoadingState";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("loading feedback", () => {
  it.each(["cards", "rows", "editor"] as const)("reserves a %s layout with one accessible loading announcement", variant => {
    const view = render(<LoadingState label="正在加载文档…" variant={variant} />);
    expect(screen.getByRole("status", { name: "正在加载文档…" })).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
  it("delays the editor body placeholder and omits the document title placeholder", () => {
    vi.useFakeTimers();
    const view = render(<LoadingState label="正在准备编辑…" variant="editor-body" delayMs={180} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { vi.advanceTimersByTime(180); });
    expect(screen.getByRole("status", { name: "正在准备编辑…" })).toHaveAttribute("aria-busy", "true");
    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    expect(view.container.querySelector('.loading-layout--editor')).toBeNull();
  });

});
