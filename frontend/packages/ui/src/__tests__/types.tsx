import { createRef } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Textarea } from "@orbis/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@orbis/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@orbis/ui/select";
import { Checkbox } from "@orbis/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { Toggle } from "@orbis/ui/toggle";
import { Badge } from "@orbis/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@orbis/ui/avatar";
import { Spinner } from "@orbis/ui/spinner";

<Button ref={createRef<HTMLButtonElement>()} variant="default" size="icon" render={<button />} disabled focusableWhenDisabled aria-busy>保存</Button>;
// @ts-expect-error use the native disabled and explicit pending content.
<Button loading>保存</Button>;
// @ts-expect-error composition uses the native render property.
<Button asChild><button>组合</button></Button>;
// @ts-expect-error primary is an obsolete application variant.
<Button variant="primary">保存</Button>;
<Input ref={createRef<HTMLInputElement>()} className="w-full" />;
// @ts-expect-error native Input className is a string.
<Input className={state => state.valid ? "valid" : "invalid"} />;
<Textarea readOnly value="正文" style={{ resize: "none" }} />;

<Dialog open onOpenChange={(open, details) => { if (!open) details.cancel(); }}>
  <DialogTrigger render={<Button />}>打开</DialogTrigger>
  <DialogContent initialFocus={createRef<HTMLInputElement>()} finalFocus={false} showCloseButton={false}>
    <DialogHeader><DialogTitle>标题</DialogTitle><DialogDescription>说明</DialogDescription></DialogHeader>
    <Input /><DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
  </DialogContent>
</Dialog>;
// @ts-expect-error obsolete dismissible policy belongs in the native change owner.
<Dialog dismissible={false} />;

<Select<number> items={[{ value: 0, label: "零" }]} value={0} onValueChange={value => { const number: number | null = value; void number; }}>
  <SelectTrigger size="sm" aria-label="数量"><SelectValue /></SelectTrigger>
  <SelectContent><SelectItem value={0}>零</SelectItem></SelectContent>
</Select>;
// @ts-expect-error native values retain the chosen item type.
<Select<number> items={[{ value: 0, label: "零" }]} value="0" />;
// @ts-expect-error labels and options are explicit native composition.
<Select options={[{ value: "a", label: "甲" }]} label="数量" />;

<Checkbox id="field" checked={false} onCheckedChange={checked => { const value: boolean = checked; void value; }} ref={createRef<HTMLElement>()} />;
<Toggle pressed onPressedChange={() => {}}>粗体</Toggle>;
<Tabs value={0} onValueChange={() => {}}><TabsList><TabsTrigger value={0}>零</TabsTrigger></TabsList><TabsContent value={0}>内容</TabsContent></Tabs>;
<Badge variant="outline" render={<a href="/" />}>链接</Badge>;
// @ts-expect-error native Badge uses variant rather than the old tone contract.
<Badge tone="neutral">标签</Badge>;
<Avatar size="default"><AvatarImage src="avatar.png" alt="头像" /><AvatarFallback>张</AvatarFallback></Avatar>;
<Spinner className="size-4" aria-label="加载中" />;
