import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@orbis/ui/select";
import { anchorAt, Popover, type Anchor } from "./Popover";

function Example() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return <>
    <button onClick={event => setAnchor(anchorAt(event.currentTarget))}>Open</button>
    <button>Outside</button>
    {anchor && <Popover anchor={anchor} label="Settings" onClose={() => setAnchor(null)}>
      <input aria-label="Name" />
      <Select value="a" items={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}>
        <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="a">Alpha</SelectItem><SelectItem value="b">Beta</SelectItem></SelectContent>
      </Select>
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
  await user.click(screen.getByRole("combobox", { name: /Category/ }));
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /Category/ })).toHaveFocus();
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
