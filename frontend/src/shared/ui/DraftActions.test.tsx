import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ConfirmAction } from "./ConfirmAction";
import { DraftActions } from "./DraftActions";
import { Toaster } from "./Toast";
import { reportRequestError } from "../api/request-feedback";

afterEach(cleanup);

it("opens draft tools in a modal only on request and restores trigger focus on Escape", async () => {
  const user = userEvent.setup();
  render(<DraftActions><Button>导出草稿</Button></DraftActions>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "导出草稿" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "本机修改" });
  await user.click(trigger);
  const modal = screen.getByRole("dialog", { name: "本机修改" });
  expect(within(modal).getByRole("button", { name: "导出草稿" })).toBeVisible();
  expect(modal.parentElement?.closest("[data-slot='modal-backdrop']")).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("keeps the draft on cancellation and requires explicit confirmation", async () => {
  const user = userEvent.setup(), discard = vi.fn();
  render(<DraftActions><ConfirmAction title="放弃草稿" description="未保存内容将被清除" confirmLabel="确认放弃" onConfirm={discard}><Button>放弃草稿</Button></ConfirmAction></DraftActions>);
  await user.click(screen.getByRole("button", { name: "本机修改" }));
  await user.click(screen.getByRole("button", { name: "放弃草稿" }));
  const alert = screen.getByRole("alertdialog", { name: "放弃草稿" });
  expect(discard).not.toHaveBeenCalled();
  expect(within(alert).getByRole("button", { name: "取消" })).toHaveFocus();
  await user.click(within(alert).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(discard).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "放弃草稿" }));
  await user.click(screen.getByRole("button", { name: "确认放弃" }));
  expect(discard).toHaveBeenCalledTimes(1);
});

it("prevents repeat confirmation while the action is pending", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<ConfirmAction title="替换修改" description="当前草稿将被替换" confirmLabel="确认替换" onConfirm={save}><Button>替换</Button></ConfirmAction>);
  await user.click(screen.getByRole("button", { name: "替换" }));
  await user.dblClick(screen.getByRole("button", { name: "确认替换" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog", { name: "替换修改" })).toBeVisible();
  await act(() => finish());
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

it("keeps a failed confirmation open without repeating the request error toast", async () => {
  const user = userEvent.setup(), error = new Error("服务端拒绝此次修改");
  render(<><Toaster /><ConfirmAction title="替换修改" description="当前草稿将被替换" confirmLabel="确认替换" onConfirm={async () => { reportRequestError(error); throw error; }}><Button>替换</Button></ConfirmAction></>);
  await user.click(screen.getByRole("button", { name: "替换" }));
  await user.click(screen.getByRole("button", { name: "确认替换" }));
  expect(screen.getByRole("alertdialog", { name: "替换修改" })).toBeVisible();
  expect(screen.getAllByText("服务端拒绝此次修改")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
});
