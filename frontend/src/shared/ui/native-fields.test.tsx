import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Input } from "@orbis/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";

it("keeps visible labels and an empty string as a real Select value", async () => {
  const change = vi.fn();
  const user = userEvent.setup();
  render(<><label>名称<Input defaultValue="原名称" /></label><Select value="name" onValueChange={change}>
    <SelectTrigger aria-label="分组"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="">不分组</SelectItem><SelectItem value="name">按名称</SelectItem></SelectContent>
  </Select></>);
  await user.clear(screen.getByRole("textbox", { name: "名称" }));
  await user.type(screen.getByRole("textbox", { name: "名称" }), "新名称");
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("新名称");
  await user.click(screen.getByRole("combobox", { name: "分组" }));
  await user.click(await screen.findByRole("option", { name: "不分组" }));
  expect(change).toHaveBeenCalledOnce();
  expect(change.mock.calls[0][0]).toBe("");
});
