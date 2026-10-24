import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRequestOptions } from "../../src/shared/auth/use-auth-request";
import { SheetGrid } from "../../src/features/sheets/SheetGrid";
import { readCellDraft } from "../../src/features/sheets/cell-draft";
import { newField, newView, type Row, type Sheet, type Value } from "../../src/features/sheets/model";

vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: (options: { count: number; estimateSize: (i: number) => number }) => ({
  getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, key: index, start: index * options.estimateSize(index), size: options.estimateSize(index), end: (index + 1) * options.estimateSize(index) })),
  getTotalSize: () => options.count * options.estimateSize(0), measure: () => {}, scrollToIndex: () => {}, scrollToOffset: () => {},
}) }));
vi.mock("../../src/features/sheets/CellEditor", () => ({ CellEditor: ({ value, onChange }: { value: Value; onChange: (value: Value) => void }) => <input aria-label="编辑草稿" value={String(value ?? "")} onChange={event => onChange(event.target.value)} /> }));
const field = { ...newField("text"), id: "field", name: "内容" };
const row: Row = { id: "row", version: 1, position: 0, values: { field: "已保存内容" }, created_at_ms: 1, updated_at_ms: 1, created_by: null, updated_by: null };
const view = newView({ definition: { fields: [field] } } as Sheet, "grid");
const auth: AuthRequestOptions = { accessToken: "a", refreshToken: null, onTokenRefresh: () => {}, onUnauthorized: () => {} };
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);
function mount(readOnly = false) {
  const onChange = vi.fn().mockResolvedValue({ records: [] });
  const onError = vi.fn();
  const onWidth = vi.fn();
  render(<SheetGrid rows={[row]} confirmedRows={[]} draftKey="grid-draft" discardVersion={0} rowOffset={0} fields={[field]} view={view} readOnly={readOnly} busy={false} hasPending={false} auth={auth} onChange={onChange} onFieldMenu={() => {}} onNewField={() => {}} onWidth={onWidth} onCreateOption={async () => ""} onInspect={() => {}} onDraftChange={() => {}} onAdd={() => {}} hasMore={false} loading={false} onMore={async () => {}} onRefresh={() => {}} onError={onError} />);
  return { onChange, onError, onWidth };
}
describe("sheet grid editing safety", () => {
  it.each(['"unterminated\n', 'first\toutside'])('preserves an unsaved draft when multiline paste is invalid: %s', clipboard => {
    const { onChange, onError } = mount();
    fireEvent.click(screen.getByRole("gridcell"));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑草稿" }), { target: { value: "不能丢失的草稿" } });
    fireEvent.paste(screen.getByRole("grid"), { clipboardData: { getData: () => clipboard } });
    expect(onError).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "编辑草稿" })).toHaveValue("不能丢失的草稿");
    expect(readCellDraft("grid-draft:cell")?.value).toBe("不能丢失的草稿");
  });
  it("does not mutate read-only column widths using the keyboard", () => {
    const { onWidth } = mount(true);
    fireEvent.keyDown(screen.getByRole("separator", { name: "调整内容列宽" }), { key: "ArrowRight" });
    expect(onWidth).not.toHaveBeenCalled();
  });
});
