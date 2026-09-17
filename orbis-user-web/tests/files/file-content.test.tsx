import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContentMedia, ManagedContentLink } from "../../src/features/content/ContentMedia";
import { FileContentContext } from "../../src/features/files/FileContent";

const reference = "orbis-file:0190a111-1111-7111-8111-111111111111";
afterEach(cleanup);

it("only resolves managed media within an authenticated content boundary", async () => {
  const view = render(<ContentMedia kind="image" reference={reference} fallback={null} name="diagram.png" />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/资源不可用/)).toBeVisible();
  const resolve = vi.fn().mockResolvedValue("blob:verified-image");
  view.rerender(<FileContentContext.Provider value={{ scope: "workspace-a", resolve }}><ContentMedia kind="image" reference={reference} fallback={null} name="diagram.png" /></FileContentContext.Provider>);
  await waitFor(() => expect(screen.getByRole("img", { name: "diagram.png" })).toHaveAttribute("src", "blob:verified-image"));
  expect(resolve).toHaveBeenCalledWith(reference);
});

it("keeps external and published resources usable without any private fetch", () => {
  render(<ContentMedia kind="image" reference="https://example.com/diagram.png" fallback="https://example.com/diagram.png" name="External" />);
  expect(screen.getByRole("img", { name: "External" })).toHaveAttribute("src", "https://example.com/diagram.png");
});

it("reports load errors and resolves an attachment again after retry", async () => {
  const resolve = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue("blob:verified-file");
  render(<FileContentContext.Provider value={{ scope: "workspace-a", resolve }}><ContentMedia kind="file" reference={reference} fallback={null} name="guide.pdf" /></FileContentContext.Provider>);
  await userEvent.click(await screen.findByRole("button", { name: "重新加载附件" }));
  const link = await screen.findByRole("link", { name: "guide.pdf" });
  expect(link).toHaveAttribute("href", "blob:verified-file");
  expect(link).toHaveAttribute("download", "guide.pdf");
});

it("does not render the previous workspace URL while a new scoped read is pending", async () => {
  const resolveA = vi.fn().mockResolvedValue("blob:workspace-a");
  const view = render(<FileContentContext.Provider value={{ scope: "a", resolve: resolveA }}><ContentMedia kind="image" reference={reference} fallback={null} name="Private" /></FileContentContext.Provider>);
  await screen.findByRole("img");
  const resolveB = vi.fn(() => new Promise<string>(() => {}));
  view.rerender(<FileContentContext.Provider value={{ scope: "b", resolve: resolveB }}><ContentMedia kind="image" reference={reference} fallback={null} name="Private" /></FileContentContext.Provider>);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("makes managed inline file links download verified bytes", async () => {
  render(<FileContentContext.Provider value={{ scope: "a", resolve: async () => "blob:verified-file" }}><ManagedContentLink reference={reference} fallback={null}>附件下载</ManagedContentLink></FileContentContext.Provider>);
  expect(await screen.findByRole("link", { name: "附件下载" })).toHaveAttribute("download");
});
