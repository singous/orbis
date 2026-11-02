import { CommandExample } from "./CommandExample";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogFooter, DialogClose, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@orbis/ui/select";
import { Spinner } from "@orbis/ui/spinner";
import { ColorField } from "../../shared/ui/ColorField";
import { Plus } from "@orbis/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { OverlayScopeProvider } from "@orbis/ui/portal";

const colorSamples = [
  { value: "rgb(18, 52, 86)", label: "RGB" },
  { value: "hsl(120, 100%, 50%)", label: "HSL" },
  { value: "hsb(240, 100%, 100%)", label: "HSB" },
  { value: "#12345680", label: "带透明度的十六进制" },
];
const groupOptions = [{ value: "", label: "不分组" }, { value: "name", label: "按名称" }];

export function UICatalog() {
  const [group, setGroup] = useState<string | null>("");
  const [color, setColor] = useState(colorSamples[0].value);
  const [colorCommits, setColorCommits] = useState(0);
  const [pending, setPending] = useState(false);
  const [activations, setActivations] = useState(0);
  const [actionActive, setActionActive] = useState(false);
  return <main className="mx-auto grid max-w-4xl gap-6 p-6">
    <h1 className="text-2xl font-semibold">界面组合预览</h1>
    <p>通用组件的详细状态见 Storybook；这里验证应用组合、主题与浮层。</p>
    {(["light", "dark"] as const).map(theme => <OverlayScopeProvider key={theme} value={{ "data-theme": theme }}><section data-theme={theme} className={`grid gap-4 rounded-xl border bg-background p-6 text-foreground ${theme === "dark" ? "dark" : ""}`}>
      <h2>{theme === "light" ? "浅色" : "深色"}表单</h2>
      <label className="grid gap-2">名称<Input defaultValue="我的视图" /></label>
      <Dialog>
        <DialogTrigger render={<Button />}>编辑分组</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑分组</DialogTitle><DialogDescription>选择视图的分组方式。</DialogDescription></DialogHeader>
          <div className="grid gap-2"><label htmlFor={`catalog-group-${theme}`}>分组方式</label><Select items={groupOptions} value={group} onValueChange={setGroup}><SelectTrigger id={`catalog-group-${theme}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent role="region" aria-label="分组方式选项">{groupOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <ColorField label="浮层颜色" value={color} onChange={setColor} onChangeEnd={() => setColorCommits(count => count + 1)} />
          <DialogFooter><DialogClose render={<Button />}>完成</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="grid gap-2"><label htmlFor={`catalog-color-${theme}`}>颜色格式</label><Select items={colorSamples} value={color} onValueChange={value => { if (value !== null) setColor(value); }}><SelectTrigger id={`catalog-color-${theme}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent role="region" aria-label="颜色格式选项">{colorSamples.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
      <ColorField label="示例颜色" value={color} onChange={setColor} onChangeEnd={() => setColorCommits(count => count + 1)} />
      <output aria-label="已选颜色">{color}</output><output aria-label="颜色提交次数">{colorCommits}</output>
    </section></OverlayScopeProvider>)}
    <section aria-label="原生控件" className="grid justify-items-start gap-4 rounded-xl border p-6">
      <h2>原生控件</h2>
      <Button data-testid="native-primary"><Plus aria-hidden="true" />保存</Button>
      <Button data-testid="native-compact" variant="outline" size="sm">取消</Button>
      <Button disabled={pending} focusableWhenDisabled={pending} aria-busy={pending || undefined} onClick={() => { setActivations(count => count + 1); setPending(true); }}>{pending ? <Spinner aria-hidden="true" /> : null}{pending ? "处理中" : "开始操作"}</Button>
      <Button variant="outline" onClick={() => setPending(false)}>结束操作</Button>
      <Button disabled>不可用</Button>
      <Button variant="ghost" size="icon" aria-label="图标操作" aria-pressed={actionActive} onClick={() => setActionActive(active => !active)}><Plus aria-hidden="true" /></Button>
      <Button variant="destructive">危险操作</Button>
      <label className="grid gap-2">普通字段<Input defaultValue="名称" /></label>
      <div className="grid gap-2"><label htmlFor="native-group">分组</label><Select items={groupOptions} value={group} onValueChange={setGroup}><SelectTrigger id="native-group"><SelectValue /></SelectTrigger><SelectContent role="region" aria-label="分组选项">{groupOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
      <output aria-label="选择">{group || "（空值）"}</output>
      <output aria-label="激活次数">{activations}</output>
    </section>
    <CommandExample />
    <section aria-label="加载布局" className="grid gap-6">
      <h2>加载布局</h2>
      {(["cards", "rows", "editor", "editor-body"] as const).map(variant => <div key={variant} data-loading-preview={variant}>
        <LoadingState label={`正在加载 ${variant}…`} variant={variant} />
      </div>)}
      <div data-loading-preview="compact"><LoadingState label="正在加载紧凑列表…" compact /></div>
    </section>
  </main>;
}
