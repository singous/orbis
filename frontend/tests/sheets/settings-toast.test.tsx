import { DEFAULT_EXIT_DURATION, DEFAULT_TOAST_TIMEOUT, toast as heroToast } from "@heroui/react/toast";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { FieldSettings } from "../../src/features/sheets/FieldSettings";
import { ViewSettings } from "../../src/features/sheets/ViewSettings";
import { newField, type Field, type View } from "../../src/features/sheets/model";
import { Toaster } from "../../src/shared/ui/Toast";

type SettingsKind = "field" | "view";
const settings = [
  { kind: "field", dialog: "字段设置", submit: "保存字段", title: "保存请求失败" },
  { kind: "view", dialog: "字段管理", submit: "应用", title: "保存请求失败" },
] as const;

function SettingsHarness({ kind, onSave, onClose }: {
  kind: SettingsKind;
  onSave: (value: Field | View) => Promise<unknown>;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [fields] = useState(() => [
    { ...newField("text"), name: "原标题" },
    { ...newField("text"), name: "备注" },
  ]);
  const [view] = useState<View>(() => ({
    id: "view", name: "表格视图", kind: "grid", field_ids: fields.map(field => field.id),
    widths: {}, filters: [], sorts: [], group_field_id: "", row_height: 40,
    text_colors: {}, highlight_duplicates: [],
  }));
  const close = () => { onClose(); setOpen(false); };
  return <>
    <button>外部操作</button>
    {open ? kind === "field"
      ? <FieldSettings field={fields[0]} anchor={{ left: 0, top: 0 }} onSave={onSave} onClose={close} />
      : <ViewSettings mode="columns" fields={fields} view={view} anchor={{ left: 0, top: 0 }} onSave={onSave} onClose={close} />
      : null}
    <Toaster />
  </>;
}

afterEach(async () => {
  cleanup();
  heroToast.clear();
  await act(() => new Promise(resolve => setTimeout(resolve, DEFAULT_EXIT_DURATION)));
});

async function dismissNotification(notification: HTMLElement, dismissal: "timeout" | "keyboard", user: ReturnType<typeof userEvent.setup>) {
  if (dismissal === "keyboard") {
    act(() => within(notification).getByRole("button", { name: "Close" }).focus());
    await user.keyboard("{Enter}");
  }
  await waitFor(() => expect(notification).not.toBeInTheDocument(), { timeout: DEFAULT_TOAST_TIMEOUT * 2 });
}

it.each(settings)("keeps the $kind settings draft when an error toast is clicked and dismissed", async scenario => {
  const onSave = vi.fn().mockRejectedValue(new Error("保存请求失败"));
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<SettingsHarness kind={scenario.kind} onSave={onSave} onClose={onClose} />);
  if (scenario.kind === "field") {
    await user.clear(screen.getByRole("textbox", { name: "字段名称" }));
    await user.type(screen.getByRole("textbox", { name: "字段名称" }), "未保存的字段名");
  } else {
    await user.click(screen.getByRole("checkbox", { name: "备注" }));
  }
  await user.click(screen.getByRole("button", { name: scenario.submit }));
  const notification = await screen.findByRole("alertdialog", { name: scenario.title });
  await user.click(within(notification).getByRole("button", { name: "Close" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: scenario.dialog })).toBeInTheDocument();
  if (scenario.kind === "field") {
    expect(screen.getByRole("textbox", { name: "字段名称" })).toHaveValue("未保存的字段名");
  } else {
    expect(screen.getByRole("checkbox", { name: "备注" })).not.toBeChecked();
  }
  await user.click(screen.getByRole("button", { name: scenario.submit }));
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
  await user.click(screen.getByRole("button", { name: "外部操作" }));
  expect(onClose).toHaveBeenCalledOnce();
});

for (const dismissal of ["timeout", "keyboard"] as const) {
  it.each(settings)(`repeats an identical $kind save error after ${dismissal} dismissal`, async scenario => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("保存请求失败"));
    const onClose = vi.fn();
    render(<SettingsHarness kind={scenario.kind} onSave={onSave} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: scenario.submit }));
    const notification = screen.getByRole("alertdialog", { name: scenario.title });
    expect(notification).toHaveTextContent("保存请求失败");
    await dismissNotification(notification, dismissal, user);
    expect(screen.queryByRole("alertdialog", { name: scenario.title })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: scenario.submit }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alertdialog", { name: scenario.title })).toHaveTextContent("保存请求失败");
    expect(onClose).not.toHaveBeenCalled();
  }, DEFAULT_TOAST_TIMEOUT * 3);

  it(`repeats an empty field-name validation error after ${dismissal} dismissal`, async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsHarness kind="field" onSave={onSave} onClose={vi.fn()} />);
    await user.clear(screen.getByRole("textbox", { name: "字段名称" }));
    await user.click(screen.getByRole("button", { name: "保存字段" }));
    const notification = screen.getByRole("alertdialog", { name: "请填写字段名称" });
    expect(notification).toHaveTextContent("请填写字段名称");
    await dismissNotification(notification, dismissal, user);
    expect(screen.queryByRole("alertdialog", { name: "请填写字段名称" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存字段" }));
    expect(screen.getByRole("alertdialog", { name: "请填写字段名称" })).toHaveTextContent("请填写字段名称");
    expect(onSave).not.toHaveBeenCalled();
  }, DEFAULT_TOAST_TIMEOUT * 3);
}
