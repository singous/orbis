import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ContentMedia, ManagedContentLink } from "../../src/features/content/ContentMedia";
import { FileContentContext } from "../../src/features/files/FileContent";

const reference = "orbis-file:0190a111-1111-7111-8111-111111111111";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("waits for a real intersection before requesting hidden or distant images", async () => {
  let changed!: IntersectionObserverCallback;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { changed = callback; } observe = observe; unobserve = vi.fn(); disconnect = disconnect; });
  const resolve = vi.fn().mockResolvedValue("blob:visible");
  const view = render(<FileContentContext.Provider value={{ scope: "a", resolve }}><div style={{ display: "none" }}><ContentMedia kind="image" reference={reference} fallback={null} name="Hidden" /></div></FileContentContext.Provider>);
  const target = observe.mock.calls[0][0] as Element;
  act(() => changed([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(resolve).not.toHaveBeenCalled();
  view.container.querySelector("div")!.style.display = "";
  act(() => changed([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  expect(await screen.findByRole("img", { name: "Hidden" })).toHaveAttribute("src", "blob:visible");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it.each(["video", "audio", "file"] as const)("does not download private %s before an explicit action", async kind => {
  const resolve = vi.fn().mockResolvedValue("blob:requested");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<FileContentContext.Provider value={{ scope: "a", resolve }}><ContentMedia kind={kind} reference={reference} fallback={null} name="Asset" /></FileContentContext.Provider>);
  expect(resolve).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: `${kind === "file" ? "下载" : "加载"}Asset` }));
  expect(resolve).toHaveBeenCalledOnce();
});

it("does not initiate a download when its workspace changed during resolution", async () => {
  let finish!: (url: string) => void;
  const resolve = vi.fn(() => new Promise<string>(done => { finish = done; }));
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<FileContentContext.Provider value={{ scope: "a", resolve }}><ManagedContentLink reference={reference} fallback={null}>File</ManagedContentLink></FileContentContext.Provider>);
  await userEvent.click(screen.getByRole("button", { name: "File" }));
  view.rerender(<FileContentContext.Provider value={{ scope: "b", resolve }}><ManagedContentLink reference={reference} fallback={null}>File</ManagedContentLink></FileContentContext.Provider>);
  await act(async () => finish("blob:old-workspace"));
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
