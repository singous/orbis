import { ImagePlus, RotateCcw, Check, LoaderCircle } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "../../shared/ui/Button";
import { NotebookIcon } from "./NotebookIcon";
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
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const currentIndex = choices.findIndex((choice) => choice === event.target);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? choices.length - 1
    : (currentIndex + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + choices.length) % choices.length;
  choices[nextIndex].focus();
  choices[nextIndex].click();
}

export function NotebookIconPicker({ value, onChange, uploadFile, onPendingChange, disabled = false }: NotebookIconPickerProps) {
  const uploadId = useId();
  const uploadVersion = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadedNotebookIcon | null>(null);
  const selected = value?.type === "preset" ? value : DEFAULT_NOTEBOOK_ICON;
  const blocked = disabled || pending;

  useEffect(() => () => { uploadVersion.current += 1; }, []);

  function chooseIcon(icon: NotebookIconValue | null) {
    setError(null);
    setPreview(null);
    onChange(icon);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const validationError = validateNotebookIconFile(file);
    setError(validationError);
    if (validationError) return;
    const version = ++uploadVersion.current;
    setPending(true);
    onPendingChange?.(true);
    try {
      const uploaded = await uploadFile(file);
      if (version !== uploadVersion.current) return;
      setPreview(uploaded);
      onChange({ type: "image", file_id: uploaded.file_id });
    } catch (uploadError) {
      if (version === uploadVersion.current) {
        setError(uploadError instanceof Error ? uploadError.message : "图标上传失败，请重试。");
      }
    } finally {
      if (version === uploadVersion.current) {
        setPending(false);
        onPendingChange?.(false);
      }
    }
  }

  return <div className="notebook-icon-picker">
    <div className="notebook-icon-picker-preview">
      <NotebookIcon icon={value} size="lg" previewUrl={value?.type === "image" && value.file_id === preview?.file_id ? preview.data_url : undefined} />
      <div><strong>笔记本图标</strong><p>用喜欢的图标，让笔记本更好找</p></div>
      <Button size="sm" variant="ghost" disabled={blocked} onClick={() => chooseIcon(null)} aria-label="恢复默认图标" title="恢复默认图标">
        <RotateCcw size={14} aria-hidden="true" />
      </Button>
    </div>
    <div className="notebook-icon-picker-grid" role="radiogroup" aria-label="预设图标" onKeyDown={handleRadioGroupKeyDown}>
      {NOTEBOOK_ICON_PRESETS.map(({ name, label }) => <button
        key={name} type="button" role="radio" aria-label={label} title={label}
        aria-checked={value?.type !== "image" && selected.name === name} disabled={blocked}
        tabIndex={selected.name === name ? 0 : -1}
        onClick={() => chooseIcon({ type: "preset", name, color: selected.color })}
      ><NotebookIcon icon={{ type: "preset", name, color: selected.color }} /></button>)}
    </div>
    <div className="notebook-icon-picker-colors" role="radiogroup" aria-label="图标颜色" onKeyDown={handleRadioGroupKeyDown}>
      {NOTEBOOK_ICON_COLORS.map(({ name, label }) => <button
        key={name} className={`notebook-icon-swatch notebook-icon--${name}`} type="button" role="radio" aria-label={label} title={label}
        aria-checked={value?.type !== "image" && selected.color === name} disabled={blocked}
        tabIndex={selected.color === name ? 0 : -1}
        onClick={() => chooseIcon({ type: "preset", name: selected.name, color: name })}
      >{value?.type !== "image" && selected.color === name ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}</button>)}
    </div>
    <div className="notebook-icon-upload">
      <label htmlFor={uploadId} className={blocked ? "notebook-icon-upload-label is-disabled" : "notebook-icon-upload-label"}>
        {pending ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
        <span>{pending ? "正在上传图片…" : "上传自定义图标"}</span>
        <input id={uploadId} type="file" accept={NOTEBOOK_ICON_MIME_TYPES.join(",")} disabled={blocked} className="sr-only" aria-label="上传自定义图标" onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <span className="notebook-icon-upload-hint">PNG、JPEG、WebP · 最大 2 MB</span>
    </div>
    {error ? <p className="notebook-icon-error" role="alert">{error}</p> : null}
  </div>;
}
