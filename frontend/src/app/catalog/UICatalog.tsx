import { CommandExample } from "./CommandExample";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogFooter, DialogClose } from "@orbis/ui/dialog";
import { Select } from "@orbis/ui/select";
import { ColorField } from "../../shared/ui/ColorField";
import { Button as CompatibleButton } from "@/shared/ui/Button";
import { iconActionVariants, textActionClassName } from "@/shared/ui/control-styles";
import { ActionButton } from "@/shared/ui/ActionButton";
import { IconButton } from "@/shared/ui/IconButton";
import { TextInput } from "@/shared/ui/TextInput";
import { SelectField } from "@/shared/ui/SelectField";
import { Plus } from "@orbis/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";

const colorSamples = [
  { value: "rgb(18, 52, 86)", label: "RGB" },
  { value: "hsl(120, 100%, 50%)", label: "HSL" },
  { value: "hsb(240, 100%, 100%)", label: "HSB" },
  { value: "#12345680", label: "带透明度的十六进制" },
];

export function UICatalog() {
  const [group, setGroup] = useState<string | null>("");
  const [color, setColor] = useState(colorSamples[0].value);
  const [colorCommits, setColorCommits] = useState(0);
  const [compatiblePending, setCompatiblePending] = useState(false);
  const [compatibleActivations, setCompatibleActivations] = useState(0);
  const [nativeActionActive, setNativeActionActive] = useState(false);
  const [compatibleSelection, setCompatibleSelection] = useState("name");
  return <main className="mx-auto grid max-w-4xl gap-6 p-6 text-ob-foreground">
    <h1 className="text-2xl font-semibold">界面组合预览</h1>
    <p>通用原语的详细状态见 Storybook；这里验证应用样式、嵌套主题与浮层组合。</p>
    {(["light", "dark"] as const).map(theme => <section key={theme} data-theme={theme} className="grid gap-4 rounded-ob-xl bg-ob-background p-6 text-ob-foreground">
      <h2>{theme === "light" ? "浅色" : "深色"}表单</h2>
      <label className="grid gap-2">名称<Input defaultValue="我的视图" /></label>
      <Dialog><DialogTrigger asChild><Button>编辑分组</Button></DialogTrigger><DialogContent title="编辑分组" description="选择视图的分组方式。">
        <Select label="分组方式" value={group} onValueChange={setGroup} options={[{ value: "", label: "不分组" }, { value: "name", label: "按名称" }]} />
        <ColorField label="浮层颜色" value={color} onChange={setColor} onChangeEnd={() => setColorCommits(count => count + 1)} />
        <DialogFooter><DialogClose asChild><Button>完成</Button></DialogClose></DialogFooter>
      </DialogContent></Dialog>
      <Select label="颜色格式" value={color} options={colorSamples} onValueChange={value => { if (value !== null) setColor(value); }} />
      <ColorField label="示例颜色" value={color} onChange={setColor} onChangeEnd={() => setColorCommits(count => count + 1)} />
      <output aria-label="已选颜色">{color}</output><output aria-label="颜色提交次数">{colorCommits}</output>
    </section>)}
    <section aria-label="兼容控件" className="grid justify-items-start gap-4 rounded-ob-xl bg-ob-background p-6 text-ob-foreground">
      <h2>兼容控件</h2>
      <CompatibleButton data-testid="compatible-primary" variant="primary" icon={<Plus aria-hidden="true" size={18} />}>兼容保存</CompatibleButton>
      <CompatibleButton data-testid="compatible-compact" size="sm">兼容取消</CompatibleButton>
      <CompatibleButton isPending={compatiblePending} onPress={() => { setCompatibleActivations(count => count + 1); setCompatiblePending(true); }}>{compatiblePending ? "兼容处理中" : "开始兼容操作"}</CompatibleButton>
      <CompatibleButton onClick={() => setCompatiblePending(false)}>结束兼容操作</CompatibleButton>
      <CompatibleButton disabled>兼容禁用</CompatibleButton>
      <ActionButton aria-label="兼容连接点" style={{ width: 12, height: 12, padding: 0 }}><Plus aria-hidden="true" size={10} /></ActionButton>
      <IconButton size="sm" aria-label="兼容图标操作"><Plus aria-hidden="true" size={16} /></IconButton>
      <ActionButton className={iconActionVariants()} aria-label="原生图标操作" aria-pressed={nativeActionActive} onClick={() => setNativeActionActive(active => !active)}><Plus aria-hidden="true" size={14} /></ActionButton>
      <ActionButton className={iconActionVariants({ tone: "danger" })} aria-label="原生危险操作"><Plus aria-hidden="true" size={14} /></ActionButton>
      <ActionButton className={iconActionVariants()} aria-label="原生禁用操作" disabled><Plus aria-hidden="true" size={14} /></ActionButton>
      <ActionButton className={textActionClassName}>原生文字操作</ActionButton>
      <div className="sheet-cell"><ActionButton aria-label="网格内连接点" style={{ width: 12, height: 12, padding: 0 }}><Plus aria-hidden="true" size={10} /></ActionButton></div>
      <TextInput label="兼容名称" defaultValue="名称" />
      <SelectField label="兼容分组" value={compatibleSelection} options={[{ value: "", label: "兼容不分组" }, { value: "name", label: "兼容按名称" }]} onChange={setCompatibleSelection} />
      <output aria-label="兼容激活次数">{compatibleActivations}</output><output aria-label="兼容选择">{compatibleSelection || "（空值）"}</output>
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
