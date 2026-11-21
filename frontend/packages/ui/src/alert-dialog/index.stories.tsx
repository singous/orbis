import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "../button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./index";

const meta = { title: "Brand/AlertDialog", component: AlertDialog } satisfies Meta<typeof AlertDialog>;
export default meta;

export const CancelFocus: StoryObj<typeof meta> = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}>删除文档</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这篇文档</AlertDialogTitle>
          <AlertDialogDescription>团队成员将无法继续访问。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="outline" />}>取消</AlertDialogCancel>
          <Button variant="destructive">确认删除</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvasElement }) => {
    const opener = within(canvasElement).getByRole("button", { name: "删除文档" });
    await userEvent.click(opener);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("alertdialog", { name: "删除这篇文档" });
    await expect(dialog).toHaveAccessibleDescription("团队成员将无法继续访问。");
    await expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(opener).toHaveFocus();
  },
};
