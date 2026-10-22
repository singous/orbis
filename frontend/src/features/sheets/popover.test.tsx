import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SelectField } from "../../shared/ui/SelectField";
import { anchorAt, Popover, type Anchor } from "./Popover";

function Example() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return <>
    <button onClick={event => setAnchor(anchorAt(event.currentTarget))}>Open</button>
    <button>Outside</button>
    {anchor && <Popover anchor={anchor} label="Settings" onClose={() => setAnchor(null)}>
      <input aria-label="Name" />
      <SelectField label="Category" value="a" options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} onChange={() => {}} />
      <button onClick={() => setAnchor(null)}>Close</button>
    </Popover>}
  </>;
}

it("restores the stable trigger after Escape or an explicit close action", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  await user.click(trigger);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(trigger).toHaveFocus();
});

it("keeps input composition and a nested selector from dismissing the parent", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape", isComposing: true });
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Category/ }));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
});

it("does not steal focus from a control clicked outside the popover", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  const outside = screen.getByRole("button", { name: "Outside" });
  await user.click(outside);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
});
