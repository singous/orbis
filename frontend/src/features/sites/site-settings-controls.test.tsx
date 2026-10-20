import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "../../shared/ui/SelectField";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { EMPTY_SITE_CONFIG } from "./SitesPage";

function Form({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState({ ...EMPTY_SITE_CONFIG });
  return <><SiteSettingsForm value={value} onChange={setValue} disabled={disabled} /><output aria-label="saved kind">{value.site_kind}</output></>;
}

describe("site settings controls", () => {
  it("retains empty-valued options without accidentally submitting the surrounding form", async () => {
    const actor = userEvent.setup();
    const change = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><SelectField label="范围" value="child" onChange={change} options={[{ value: "", label: "整个笔记本" }, { value: "child", label: "子文档" }]} /></form>);
    await actor.click(screen.getByRole("button", { name: /范围/ }));
    await actor.click(screen.getByRole("option", { name: "整个笔记本" }));
    expect(change).toHaveBeenCalledWith("");
    expect(submit).not.toHaveBeenCalled();
  });
  it("opens an accessible custom list and commits the chosen site kind", async () => {
    const actor = userEvent.setup();
    render(<Form />);
    await actor.click(screen.getByRole("button", { name: /站点场景/ }));
    await actor.click(screen.getByRole("option", { name: "产品手册" }));
    expect(screen.getByRole("status", { name: "saved kind" })).toHaveTextContent("handbook");
    await waitFor(() => expect(screen.getByRole("button", { name: /站点场景/ })).toHaveFocus());
  });

  it("disables custom selects and the color picker for a read-only form", () => {
    render(<Form disabled />);
    expect(screen.getByRole("button", { name: /站点场景/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /阅读主题/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择主题色" })).toBeDisabled();
    expect(screen.getByLabelText("站点名称")).toBeDisabled();
  });
});
