import { useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker } from "@orbis/ui/color-picker";
import { Input } from "@orbis/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@orbis/ui/popover";
import { cn } from "./cn";

type ColorFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onChangeEnd?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};
const DEFAULT_PICKER_COLOR = "#000000";
const MAX_RGB_COLOR = 0xFFFFFF;

export function ColorField({ value, onChange, onChangeEnd, disabled = false, label = "主题色", className }: ColorFieldProps) {
  const hexValue = useMemo(() => colorToHex(value) ?? DEFAULT_PICKER_COLOR, [value]);
  const [draft, setDraft] = useState(hexValue);
  const [requestedOpen, setOpen] = useState(false);
  const focused = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => { if (!focused.current) setDraft(hexValue); }, [hexValue]);

  function commitDraft() {
    if (disabled) return;
    const parsed = hexToColor(draft);
    if (parsed && parsed !== hexValue) {
      latest.current = parsed;
      onChange(parsed);
    }
    setDraft(parsed ?? hexValue);
    onChangeEnd?.(latest.current);
  }
  return <div className={cn("grid min-w-0 content-start gap-2", className)}>
    <span className="text-sm font-medium text-ob-foreground">{label}</span>
    <Popover open={requestedOpen} onOpenChange={open => {
      if (!open && focused.current) { commitDraft(); focused.current = false; }
      setOpen(open);
    }}>
      <PopoverTrigger disabled={disabled} aria-label={`选择${label} ${value}`} className="flex min-h-(--ob-control-height-md) items-center gap-2.5 rounded-ob-sm text-sm text-ob-foreground disabled:cursor-not-allowed disabled:opacity-50">
        <span aria-hidden="true" className="size-7 shrink-0 rounded-ob-sm border border-ob-border" style={{ backgroundColor: value }} /><span>{value}</span>
      </PopoverTrigger>
      <PopoverContent aria-label={`选择${label}`} side="bottom" align="start" className="grid w-65 max-w-(--available-width) gap-4 p-4">
        <ColorPicker value={hexValue} disabled={disabled} onValueChange={color => { latest.current = color; onChange(color); }} onValueChangeEnd={color => { if (!disabled) onChangeEnd?.(color); }} />
        <label className="grid gap-1.5 text-sm font-medium text-ob-foreground">颜色值<Input aria-label="十六进制颜色" value={draft} disabled={disabled} onFocus={() => { focused.current = true; }} onChange={event => { if (/^#?[0-9a-f]{0,6}$/i.test(event.target.value)) setDraft(event.target.value); }} onBlur={() => { if (focused.current) commitDraft(); focused.current = false; }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const current = parseInt((hexToColor(draft) ?? DEFAULT_PICKER_COLOR).slice(1), 16);
            const next = Math.min(MAX_RGB_COLOR, Math.max(0, current + (event.key === "ArrowUp" ? 1 : -1)));
            const color = `#${next.toString(16).padStart(6, "0").toUpperCase()}`;
            setDraft(color);
            if (color !== hexValue) { latest.current = color; onChange(color); }
          }
        }} /></label>
      </PopoverContent>
    </Popover>
  </div>;
}

function hexToColor(value: string): string | null {
  const raw = value.trim().replace(/^#/, "");
  if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(raw)) return null;
  const expanded = raw.length < 6 ? [...raw].map(channel => channel.repeat(2)).join("") : raw;
  return `#${expanded.slice(0, 6).toUpperCase()}`;
}

function colorToHex(value: string): string | null {
  const hex = value.startsWith("#") ? hexToColor(value) : null;
  if (hex) return hex;
  let cssValue = value;
  const hsb = /^hsba?\(([^)]+)\)$/.exec(value);
  if (hsb) {
    const [hue, rawSaturation, rawBrightness] = hsb[1].split(",").map(channel => Number(channel.trim().replace("%", "")));
    const saturation = Math.min(100, Math.max(0, rawSaturation));
    const brightness = Math.min(100, Math.max(0, rawBrightness));
    const lightness = brightness / 100 * (1 - saturation / 200);
    const hslSaturation = lightness === 0 || lightness === 1 ? 0 : (brightness / 100 - lightness) / Math.min(lightness, 1 - lightness);
    cssValue = `hsl(${hue}, ${hslSaturation * 100}%, ${lightness * 100}%)`;
  }
  const parser = document.createElement("span").style;
  parser.color = cssValue;
  return rgbToHex(parser.color);
}

function rgbToHex(value: string): string | null {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  return rgb ? `#${rgb.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, "0")).join("").toUpperCase()}` : null;
}
