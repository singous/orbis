import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useEffect, useState } from "react";
import { Combobox, ComboboxRoot, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./index";

const items = ["产品", "设计", "研发"];
const meta = { title: "Brand/Combobox" } satisfies Meta;
export default meta;

export const InlineMultiple: StoryObj<typeof meta> = {
  render: () => (
    <ComboboxRoot inline open multiple items={items}>
      <div className="w-64 space-y-1.5 rounded-xl border border-border bg-card p-2">
        <ComboboxInput aria-label="搜索团队" />
        <ComboboxEmpty>没有匹配的团队</ComboboxEmpty>
        <ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList>
      </div>
    </ComboboxRoot>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("combobox", { name: "搜索团队" });
    await userEvent.type(search, "设");
    await expect(canvas.queryByRole("option", { name: "产品" })).toBeNull();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(canvas.getByRole("option", { name: "设计" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(search).toHaveFocus());
  },
};

const countries = [
  { label: "亚洲", items: [{ value: "cn", label: "中国" }, { value: "jp", label: "日本" }] },
  { label: "欧洲", items: [{ value: "gb", label: "英国" }, { value: "fr", label: "法国" }] },
];
const members = [{ value: "prod", label: "产品设计" }, { value: "dev", label: "前端研发" }, { value: "ops", label: "内容运营" }];

export const GroupedSingle: StoryObj<typeof meta> = {
  render: () => (
    <Combobox items={countries} label="可搜索国家" placeholder="选择国家" search={{ mode: "local", placement: "popup", placeholder: "搜索国家" }} className="w-64" />
  ),
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = within(canvasElement).getByLabelText("可搜索国家");
    await userEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "搜索国家" });
    await expect(trigger).toHaveFocus();
    await userEvent.click(search);
    await expect(search).toHaveFocus();
    await expect(screen.getByRole("group", { name: "亚洲" })).toBeVisible();
    await userEvent.type(search, "不存在");
    await expect(screen.getByText("没有匹配的选项")).toBeVisible();
    await userEvent.clear(search);
    await userEvent.type(search, "法");
    await expect(screen.queryByRole("group", { name: "亚洲" })).toBeNull();
    await expect(within(screen.getByRole("group", { name: "欧洲" })).getByRole("option", { name: "法国" })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(trigger).toHaveTextContent("法国");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const PopoverMultiple: StoryObj<typeof meta> = {
  render: () => (
    <Combobox multiple items={members} label="团队成员" search={{ mode: "local", placement: "popup", placeholder: "搜索团队成员" }} defaultValue={["prod"]} className="w-64" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByLabelText("团队成员");
    await userEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "搜索团队成员" });
    await expect(trigger).toHaveFocus();
    await userEvent.tab();
    await expect(search).toHaveFocus();
    await userEvent.type(search, "研发");
    await userEvent.click(screen.getByRole("option", { name: "前端研发" }));
    await expect(search).toHaveValue("研发");
    await expect(screen.getByRole("option", { name: "前端研发" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    const remove = canvas.getByRole("button", { name: "移除 前端研发" });
    await expect(remove).toBeVisible();
    remove.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.queryByRole("button", { name: "移除 前端研发" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(canvas.getByRole("button", { name: "清空已选选项" }));
    await expect(canvas.queryByRole("button", { name: "移除 产品设计" })).toBeNull();
  },
};

export const GroupedWithoutSearch: StoryObj<typeof meta> = {
  render: () => <Combobox items={countries} label="国家" defaultValue="cn" className="w-64" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("combobox", { name: "国家" });
    await userEvent.click(trigger);
    const list = await screen.findByRole("listbox", { name: "国家" });
    await waitFor(() => expect(within(list).getByRole("group", { name: "欧洲" })).toBeVisible());
    await userEvent.click(within(list).getByRole("option", { name: "法国" }));
    await expect(trigger).toHaveTextContent("法国");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "国家" })).not.toBeInTheDocument());
  },
};

function ControlledLocalExample() {
  const [query, setQuery] = useState("");
  return <Combobox items={members} label="筛选团队" search={{ mode: "local", query, onQueryChange: setQuery }} className="w-64" />;
}

export const ControlledLocal: StoryObj<typeof meta> = {
  render: () => <ControlledLocalExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const input = canvas.getByRole("combobox", { name: "筛选团队" });
    await userEvent.type(input, "研发");
    await expect(input).toHaveValue("研发");
    await expect(await screen.findByRole("option", { name: "前端研发" })).toBeVisible();
    await expect(screen.queryByRole("option", { name: "产品设计" })).toBeNull();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("前端研发");
  },
};

const characters = [{ value: "a", label: "Luke Skywalker" }, { value: "b", label: "R2-D2" }];

function ControlledRemoteExample() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(characters);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setResults(query ? [characters[1]] : characters);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [query, loading]);
  return (
    <Combobox
      items={characters}
      label="角色"
      defaultValue="a"
      search={{ mode: "remote", placeholder: "搜索角色", query, results, loading, onQueryChange: next => { setQuery(next); setLoading(true); } }}
      className="w-64"
    />
  );
}

export const ControlledRemote: StoryObj<typeof meta> = {
  render: () => <ControlledRemoteExample />,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = within(canvasElement).getByRole("combobox", { name: "角色" });
    await userEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "搜索角色" });
    await expect(trigger).toHaveFocus();
    await userEvent.click(search);
    await expect(search).toHaveFocus();
    await userEvent.type(search, "机器人");
    await expect(screen.getByRole("status", { name: "正在搜索" })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在搜索" })).not.toBeInTheDocument());
    await expect(screen.queryByRole("option", { name: "Luke Skywalker" })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: "R2-D2" }));
    await expect(trigger).toHaveTextContent("R2-D2");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const reopenedSearch = await screen.findByRole("combobox", { name: "搜索角色" });
    await expect(trigger).toHaveFocus();
    await userEvent.tab();
    await expect(reopenedSearch).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
