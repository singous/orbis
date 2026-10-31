import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "../../shared/ui/SelectField";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { EMPTY_SITE_CONFIG } from "./SitesPage";

function Form({ disabled = false, initialColor }: { disabled?: boolean; initialColor?: string }) {
  const [value, setValue] = useState({ ...EMPTY_SITE_CONFIG, accent_color: initialColor ?? EMPTY_SITE_CONFIG.accent_color });
  return <><SiteSettingsForm value={value} onChange={setValue} disabled={disabled} /><output aria-label="saved kind">{value.site_kind}</output><output aria-label="saved color">{value.accent_color}</output></>;
}

describe("site settings controls", () => {
  it("retains empty-valued options without accidentally submitting the surrounding form", async () => {
    const actor = userEvent.setup();
    const change = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><SelectField label="范围" value="child" onChange={change} options={[{ value: "", label: "整个笔记本" }, { value: "child", label: "子文档" }]} /></form>);
    await actor.click(screen.getByRole("combobox", { name: /范围/ }));
    await actor.click(await screen.findByRole("option", { name: "整个笔记本" }));
    expect(change).toHaveBeenCalledWith("");
    expect(submit).not.toHaveBeenCalled();
  });
  it("opens an accessible custom list and commits the chosen site kind", async () => {
    const actor = userEvent.setup();
    render(<Form />);
    await actor.click(screen.getByRole("combobox", { name: /站点场景/ }));
    await actor.click(await screen.findByRole("option", { name: "产品手册" }));
    expect(screen.getByRole("status", { name: "saved kind" })).toHaveTextContent("handbook");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /站点场景/ })).toHaveFocus());
  });

  it("disables custom selects and the color picker for a read-only form", () => {
    render(<Form disabled />);
    expect(screen.getByRole("combobox", { name: /站点场景/ })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /阅读主题/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /选择主题色/ })).toBeDisabled();
    expect(screen.getByLabelText("站点名称")).toBeDisabled();
  });
});

it("keeps site color input local until Enter and does not submit the surrounding form", async () => {
  const actor = userEvent.setup();
  const submit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={submit}><Form /></form>);
  const stored = screen.getByRole("status", { name: "saved color" });
  const previous = stored.textContent;
  await actor.click(screen.getByRole("button", { name: /选择主题色/ }));
  const input = screen.getByRole("textbox", { name: "十六进制颜色" });
  await actor.clear(input);
  await actor.type(input, "abcdef");
  expect(stored).toHaveTextContent(previous!);
  await actor.keyboard("{Enter}");
  expect(stored).toHaveTextContent("#ABCDEF");
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  ["rgb(12, 34, 56)", "#0C2238"],
  ["hsl(273, 61%, 37%)", "#642598"],
  ["hsb(237, 17%, 43%)", "#5B5C6E"],
  ["#abc8", "#AABBCC"],
  ["#a1b2c380", "#A1B2C3"],
])("displays the legacy %s color format without rewriting the source value", async (original, expected) => {
  const actor = userEvent.setup();
  render(<Form initialColor={original} />);
  await actor.click(screen.getByRole("button", { name: /选择主题色/ }));
  expect(screen.getByRole("textbox", { name: "十六进制颜色" })).toHaveValue(expected);
  await actor.keyboard("{Escape}");
  expect(screen.getByRole("status", { name: "saved color" })).toHaveTextContent(original);
});
