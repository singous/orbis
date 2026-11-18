import { DropdownMenu, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Popover, PopoverTrigger } from "@orbis/ui/popover";
import { Tooltip, TooltipTrigger } from "@orbis/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";

<DropdownMenu open onOpenChange={() => {}}>内容</DropdownMenu>;
<DropdownMenuItem render={<a href="/guide" />}>指南</DropdownMenuItem>;
<DropdownMenuTrigger render={<button />}>打开</DropdownMenuTrigger>;
<DropdownMenuCheckboxItem checked onCheckedChange={checked => { const boolean: boolean = checked; void boolean; }}>固定</DropdownMenuCheckboxItem>;
<DropdownMenuRadioGroup value="list" onValueChange={() => {}} />;
<Popover open onOpenChange={() => {}}><PopoverTrigger render={<button />}>打开</PopoverTrigger></Popover>;
<Tooltip><TooltipTrigger render={<a href="/guide" />}>指南</TooltipTrigger></Tooltip>;
<RadioGroup value="one" onValueChange={() => {}}><RadioGroupItem value="one" id="radio-one" /></RadioGroup>;
// @ts-expect-error native Menu composition uses render, not the old asChild shorthand.
<DropdownMenuItem asChild><a href="/guide">指南</a></DropdownMenuItem>;
// @ts-expect-error typeahead uses the native label property.
<DropdownMenuItem textValue="动作">动作</DropdownMenuItem>;
// @ts-expect-error Tooltip root does not render its trigger.
<Tooltip render={<button />}>内容</Tooltip>;
