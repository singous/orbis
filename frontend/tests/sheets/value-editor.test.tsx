import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValueEditor } from "../../src/features/sheets/Cell";
import { newField } from "../../src/features/sheets/model";

afterEach(cleanup);
describe("sheet date values", () => {
  it.each([false, true])("preserves epoch zero when include_time is %s", include_time => {
    const field = { ...newField("datetime"), name: "日期", include_time };
    render(<ValueEditor field={field} value={0} onChange={() => {}} />);
    expect(screen.getByLabelText("日期")).toHaveValue(include_time ? "1970-01-01T08:00" : "1970-01-01");
  });
});

describe("attachment upload lifecycle", () => {
  it("does not deliver a completed upload to an editor that has been closed", async () => {
    let finish!: (id: string) => void;
    const publicUpload = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const field = { ...newField("attachment"), name: "附件" };
    const { unmount } = render(<ValueEditor field={field} value={[]} publicUpload={publicUpload} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("附件"), { target: { files: [new File(["file"], "draft.txt")] } });
    expect(publicUpload).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { finish("uploaded-file"); });
    expect(onChange).not.toHaveBeenCalled();
  });
  it("preserves attachment removals made while another file is uploading", async () => {
    let finish!: (id: string) => void;
    const publicUpload = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const field = { ...newField("attachment"), name: "附件" };
    const { rerender } = render(<ValueEditor field={field} value={["previous-file"]} publicUpload={publicUpload} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("附件"), { target: { files: [new File(["file"], "draft.txt")] } });
    rerender(<ValueEditor field={field} value={[]} publicUpload={publicUpload} onChange={onChange} />);
    await act(async () => { finish("uploaded-file"); });
    expect(onChange).toHaveBeenLastCalledWith(["uploaded-file"]);
  });
});
