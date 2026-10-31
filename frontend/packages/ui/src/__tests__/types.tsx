import { createRef } from "react";
import { Button } from "@orbis/ui/button";
import { Dialog } from "@orbis/ui/dialog";
import { Select } from "@orbis/ui/select";
import { Textarea } from "@orbis/ui/textarea";
import { DialogContent, DialogTrigger, DialogClose, DialogPopup, DialogTitle } from "@orbis/ui/dialog";
import { Input } from "@orbis/ui/input";

<Button ref={createRef<HTMLButtonElement>()} loading onClick={event => event.currentTarget.focus()}>保存</Button>;
<Button asChild><button>组合</button></Button>;
<Input ref={createRef<HTMLInputElement>()} className={state => state.valid ? "valid" : "unchecked"} />;
// @ts-expect-error render is an implementation detail; use asChild.
<Button render={<button />} />;
// @ts-expect-error composed buttons require one element.
<Button asChild>text</Button>;
// @ts-expect-error variants are an explicit public contract.
<Button variant="default" />;

// Controlled overlays require a change handler and cannot also be uncontrolled.
<Dialog open onOpenChange={() => {}}>内容</Dialog>;
// @ts-expect-error choose controlled or uncontrolled, not both.
<Dialog open defaultOpen onOpenChange={() => {}}>内容</Dialog>;
// @ts-expect-error controlled dialogs require an owner.
<Dialog open>内容</Dialog>;
<Select options={[{ value: 0, label: "零" }]} value={0} onValueChange={value => { const number: number | null = value; void number; }} />;
// @ts-expect-error selected values must match the option type.
<Select<number> options={[{ value: 0, label: "零" }]} value="0" onValueChange={() => {}} />;

<Textarea readOnly className={state => state.readOnly ? "read-only" : undefined} style={state => ({ resize: state.disabled ? "none" : "vertical" })} />;
<Select options={[{ value: 0, label: "零" }]} defaultValue={0} density="compact" wrapperClassName="max-w-80" description="数量" aria-labelledby="count-label" className={state => state.value === 0 ? "zero" : "other"} style={state => ({ minWidth: state.disabled ? 120 : 80 })} />;
// @ts-expect-error controlled open state requires an owner.
<Select options={[{ value: 0, label: "零" }]} open />;
// @ts-expect-error controlled and uncontrolled open props cannot be combined.
<Select options={[{ value: 0, label: "零" }]} open defaultOpen onOpenChange={() => {}} />;
<Dialog defaultOpen><DialogTrigger className={state => state.open ? "open" : "closed"}>打开</DialogTrigger><DialogContent title="标题" className={state => state.nested ? "nested" : undefined} style={state => ({ minHeight: state.open ? 120 : 80 })}><DialogClose style={state => ({ opacity: state.disabled ? 0.5 : 1 })}>关闭</DialogClose></DialogContent></Dialog>;

<Dialog open onOpenChange={() => {}} onOpenChangeComplete={open => { const completed: boolean = open; void completed; }}><DialogPopup initialFocus={createRef<HTMLInputElement>()} finalFocus={false} backdropClassName="backdrop" viewportClassName="p-0"><DialogTitle>组合浮层</DialogTitle><Input /></DialogPopup></Dialog>;

<Dialog dismissOnOutsidePress={false} onOpenChangeComplete={() => {}}>内容</Dialog>;

<Dialog><DialogPopup portalContainer={createRef<HTMLDivElement>()}><DialogTitle>局部挂载</DialogTitle></DialogPopup></Dialog>;

import { Checkbox } from "@orbis/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { Toggle } from "@orbis/ui/toggle";
<Checkbox checked={false} onCheckedChange={checked => { const value: boolean = checked; void value; }} wrapperClassName="gap-3" className={state => state.indeterminate ? "mixed" : ""} style={state => ({ opacity: state.disabled ? 0.5 : 1 })} ref={createRef<HTMLButtonElement>()}>字段</Checkbox>;
// @ts-expect-error controlled checkbox cannot also specify default value.
<Checkbox checked defaultChecked onCheckedChange={() => {}} />;
// @ts-expect-error controlled toggles need a change owner.
<Toggle pressed />;
<Tabs<number> value={0} onValueChange={value => { const next: number | null = value; void next; }}><TabsList><TabsTrigger value={0}>零</TabsTrigger></TabsList><TabsContent value={0}>内容</TabsContent></Tabs>;
