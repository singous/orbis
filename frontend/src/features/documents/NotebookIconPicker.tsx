import { reportError } from "../../shared/api/request-feedback";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";
import { ImagePlus, RotateCcw, LoaderCircle } from "../../shared/ui/icons";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "@orbis/ui/button";
import { NotebookIcon, NOTEBOOK_ICON_COLOR_CLASSES } from "./NotebookIcon";
import type { UploadedNotebookIcon } from "./notebook-icon-api";
import {
  DEFAULT_NOTEBOOK_ICON, NOTEBOOK_ICON_COLORS, NOTEBOOK_ICON_MIME_TYPES,
  NOTEBOOK_ICON_PRESETS, validateNotebookIconFile, type NotebookIconValue,
} from "./notebook-icons";

export type NotebookIconPickerProps = {
  value: NotebookIconValue | null;
  onChange: (icon: NotebookIconValue | null) => void;
  uploadFile: (file: File) => Promise<UploadedNotebookIcon>;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
};

function handleRadioGroupKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Home" && event.key !== "End") return;
  if (!(event.target instanceof Element)) return;
  const group = event.target.closest('[role="radiogroup"]');
  const choices = Array.from(group?.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])') ?? []);
  if (!choices.length) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.key === "Home" ? choices[0] : choices[choices.length - 1];
  target.focus();
  target.click();
}

export function NotebookIconPicker({ value, onChange, uploadFile, onPendingChange, disabled = false }: NotebookIconPickerProps) {
  const uploadId = useId();
  const uploadVersion = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<UploadedNotebookIcon | null>(null);
  const selected = value?.type === "preset" ? value : DEFAULT_NOTEBOOK_ICON;
  const blocked = disabled || pending;

  useEffect(() => () => { uploadVersion.current += 1; }, []);

  function chooseIcon(icon: NotebookIconValue | null) {
    setPreview(null);
    onChange(icon);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const validationError = validateNotebookIconFile(file);
    if (validationError) {
      reportError(validationError);
      return;
    }
    const version = ++uploadVersion.current;
    setPending(true);
    onPendingChange?.(true);
    try {
      const uploaded = await uploadFile(file);
      if (version !== uploadVersion.current) return;
      setPreview(uploaded);
      onChange({ type: "image", asset_id: uploaded.asset_id });
    } catch (uploadError) {
      if (version === uploadVersion.current) {
        reportError(uploadError);
      }
    } finally {
      if (version === uploadVersion.current) {
        setPending(false);
        onPendingChange?.(false);
      }
    }
  }

  return <div className="notebook-icon-picker grid gap-4" onKeyDownCapture={handleRadioGroupKeyDown}>
    <div className="notebook-icon-picker-preview mb-4.5 flex items-center gap-3.5 max-[420px]:gap-[11px]">
      <NotebookIcon icon={value} size="lg" previewUrl={value?.type === "image" && value.asset_id === preview?.asset_id ? preview.data_url : undefined} />
      <div className="min-w-0 flex-1"><strong className="text-sm font-medium text-foreground">笔记本图标</strong><p className="mt-1.25 text-xs text-(--muted-foreground)">用喜欢的图标，让笔记本更好找</p></div>
      <Button size="sm" variant="ghost" className="disabled:cursor-default disabled:opacity-45" disabled={blocked} onClick={() => chooseIcon(null)} aria-label="恢复默认图标" title="恢复默认图标">
        <RotateCcw size={14} aria-hidden="true" />
      </Button>
    </div>
    <RadioGroup className="notebook-icon-picker-grid grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="预设图标" value={value?.type === "image" ? "" : selected.name} disabled={blocked} onValueChange={(nextName) => {
      const preset = NOTEBOOK_ICON_PRESETS.find((item) => item.name === nextName);
      if (preset) chooseIcon({ type: "preset", name: preset.name, color: selected.color });
    }}>
      {NOTEBOOK_ICON_PRESETS.map(({ name, label }) => <div key={name} className="notebook-icon-choice flex items-center gap-2">
        <RadioGroupItem id={`${uploadId}-preset-${name}`} value={name} aria-label={label} />
        <label htmlFor={`${uploadId}-preset-${name}`} className="cursor-pointer" title={label}>
          <NotebookIcon icon={{ type: "preset", name, color: selected.color }} />
          <span className="sr-only">{label}</span>
        </label>
      </div>)}
    </RadioGroup>
    <RadioGroup className="notebook-icon-picker-colors flex flex-row flex-wrap gap-3" aria-label="图标颜色" aria-orientation="horizontal" value={value?.type === "image" ? "" : selected.color} disabled={blocked} onValueChange={(nextColor) => {
      const color = NOTEBOOK_ICON_COLORS.find((item) => item.name === nextColor);
      if (color) chooseIcon({ type: "preset", name: selected.name, color: color.name });
    }}>
      {NOTEBOOK_ICON_COLORS.map(({ name, label }) => <div key={name} className="notebook-icon-color-choice flex items-center gap-2">
        <RadioGroupItem id={`${uploadId}-color-${name}`} value={name} aria-label={label} />
        <label htmlFor={`${uploadId}-color-${name}`} className="cursor-pointer" title={label}>
          <span className={`notebook-icon-swatch block size-6 rounded-full bg-(--notebook-icon-fg) notebook-icon--${name} ${NOTEBOOK_ICON_COLOR_CLASSES[name]}`} />
          <span className="sr-only">{label}</span>
        </label>
      </div>)}
    </RadioGroup>
    <div className="notebook-icon-upload flex flex-col items-center gap-2 border-t border-border pt-4.5">
      <Button variant="secondary" className="disabled:cursor-default disabled:opacity-45" disabled={blocked} onClick={event => { event.stopPropagation(); fileInputRef.current?.click(); }}>
        {pending ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
        <span>{pending ? "正在上传图片…" : "上传自定义图标"}</span>
      </Button>
      <input hidden ref={fileInputRef} id={uploadId} type="file" accept={NOTEBOOK_ICON_MIME_TYPES.join(",")} disabled={blocked} aria-label="上传自定义图标" onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
      <span className="notebook-icon-upload-hint text-xs text-(--muted-foreground)">PNG、JPEG、WebP · 最大 2 MB</span>
    </div>
  </div>;
}
