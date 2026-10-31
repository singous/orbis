import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Tooltip } from "../../src/shared/ui/Tooltip";

describe("Tooltip trigger composition", () => {
  it("preserves the trigger keyboard and focus handlers", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onKeyDown = vi.fn();
    render(<Tooltip label="操作说明"><button onFocus={onFocus} onKeyDown={onKeyDown}>操作</button></Tooltip>);

    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("操作说明");
    await user.keyboard("{Enter}");

    expect(onFocus).toHaveBeenCalledOnce();
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  it("keeps the consumer ref attached to the trigger", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Tooltip label="操作说明"><button ref={ref}>操作</button></Tooltip>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "操作" }));
  });

  it("preserves an explicitly excluded tab stop", async () => {
    const user = userEvent.setup();
    render(<><Tooltip label="操作说明"><button tabIndex={-1}>操作</button></Tooltip><button>下一项</button></>);

    await user.tab();

    expect(screen.getByRole("button", { name: "操作" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "下一项" })).toHaveFocus();
  });
});
