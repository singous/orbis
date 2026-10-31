import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogFooter, DialogClose } from "@orbis/ui/dialog";
import { Select } from "@orbis/ui/select";

export function UICatalog() {
  const [group, setGroup] = useState<string | null>("");
  return <main className="mx-auto grid max-w-4xl gap-6 p-6 text-ob-foreground">
    <h1 className="text-2xl font-semibold">界面组合预览</h1>
    <p>通用原语的详细状态见 Storybook；这里验证应用样式、嵌套主题与浮层组合。</p>
    {(["light", "dark"] as const).map(theme => <section key={theme} data-theme={theme} className="grid gap-4 rounded-ob-xl bg-ob-background p-6 text-ob-foreground">
      <h2>{theme === "light" ? "浅色" : "深色"}表单</h2>
      <label className="grid gap-2">名称<Input defaultValue="我的视图" /></label>
      <Dialog><DialogTrigger asChild><Button>编辑分组</Button></DialogTrigger><DialogContent title="编辑分组" description="选择视图的分组方式。">
        <Select label="分组方式" value={group} onValueChange={setGroup} options={[{ value: "", label: "不分组" }, { value: "name", label: "按名称" }]} />
        <DialogFooter><DialogClose asChild><Button>完成</Button></DialogClose></DialogFooter>
      </DialogContent></Dialog>
    </section>)}
  </main>;
}
