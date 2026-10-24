import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FieldSettings } from "../../src/features/sheets/FieldSettings";
import { newField } from "../../src/features/sheets/model";

afterEach(cleanup);
it("reorders field options with keyboard actions and saves the original option identities", async () => {
  const field = newField("select");
  const onSave = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<FieldSettings field={field} anchor={{ left: 0, top: 0 }} onSave={onSave} onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "上移选项 1 待开始" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下移选项 3 已完成" })).toBeDisabled();
  act(() => screen.getByRole("button", { name: "上移选项 2 进行中" }).focus());
  await user.keyboard("{Enter}");
  expect(screen.getByRole("textbox", { name: "选项 1" })).toHaveValue("进行中");
  expect(screen.getByRole("textbox", { name: "选项 2" })).toHaveValue("待开始");
  act(() => screen.getByRole("button", { name: "下移选项 2 待开始" }).focus());
  await user.keyboard(" ");
  expect(screen.getByRole("textbox", { name: "选项 3" })).toHaveValue("待开始");
  await user.click(screen.getByRole("button", { name: "保存字段" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].options).toEqual([field.options[1], field.options[2], field.options[0]]);
});
it("retains drag reordering through the same option move operation", () => {
  const field = newField("select");
  render(<FieldSettings field={field} anchor={{ left: 0, top: 0 }} onSave={async () => {}} onClose={() => {}} />);
  const target = screen.getByRole("textbox", { name: "选项 3" }).closest(".sheet-option-edit")!;
  fireEvent.drop(target, { dataTransfer: { getData: () => "0" } });
  expect(screen.getByRole("textbox", { name: "选项 3" })).toHaveValue("待开始");
});
