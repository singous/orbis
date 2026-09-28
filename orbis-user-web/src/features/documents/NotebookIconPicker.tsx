import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { ImagePlus, RotateCcw, Check, LoaderCircle } from "../../shared/ui/icons";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "../../shared/ui/Button";
import { showToast } from "../../shared/ui/Toast";
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
  if (event.key !== "Home" && event.key !== "End") return;
  if (!(event.target instanceof Element)) return;
  const group = event.target.closest('[role="radiogroup"]');
  const choices = Array.from(group?.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)') ?? []);
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
      showToast({ title: "无法上传图标", description: validationError, tone: "danger" });
      return;
    }
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
        showToast({ title: "图标上传失败", description: uploadError instanceof Error ? uploadError.message : "请重试。", tone: "danger" });
      }
    } finally {
      if (version === uploadVersion.current) {
        setPending(false);
        onPendingChange?.(false);
      }
    }
  }

  return <div className="notebook-icon-picker" onKeyDownCapture={handleRadioGroupKeyDown}>
    <div className="notebook-icon-picker-preview">
      <NotebookIcon icon={value} size="lg" previewUrl={value?.type === "image" && value.file_id === preview?.file_id ? preview.data_url : undefined} />
      <div><strong>笔记本图标</strong><p>用喜欢的图标，让笔记本更好找</p></div>
      <Button size="sm" variant="ghost" disabled={blocked} onClick={() => chooseIcon(null)} aria-label="恢复默认图标" title="恢复默认图标">
        <RotateCcw size={14} aria-hidden="true" />
      </Button>
    </div>
    <RadioGroup className="notebook-icon-picker-grid" aria-label="预设图标" value={value?.type === "image" ? "" : selected.name} isDisabled={blocked} onChange={(nextName) => {
      const preset = NOTEBOOK_ICON_PRESETS.find((item) => item.name === nextName);
      if (preset) chooseIcon({ type: "preset", name: preset.name, color: selected.color });
    }}>
      {NOTEBOOK_ICON_PRESETS.map(({ name, label }) => <Radio key={name} value={name} aria-label={label} render={(props) => <div {...props} title={label} />}>
        <Radio.Content className="notebook-icon-choice"><NotebookIcon icon={{ type: "preset", name, color: selected.color }} /></Radio.Content>
      </Radio>)}
    </RadioGroup>
    <RadioGroup className="notebook-icon-picker-colors" aria-label="图标颜色" orientation="horizontal" value={value?.type === "image" ? "" : selected.color} isDisabled={blocked} onChange={(nextColor) => {
      const color = NOTEBOOK_ICON_COLORS.find((item) => item.name === nextColor);
      if (color) chooseIcon({ type: "preset", name: selected.name, color: color.name });
    }}>
      {NOTEBOOK_ICON_COLORS.map(({ name, label }) => <Radio key={name} value={name} aria-label={label} render={(props) => <div {...props} title={label} />}>
        <Radio.Content className={`notebook-icon-swatch notebook-icon--${name}`}>
          {({ isSelected }) => isSelected ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
        </Radio.Content>
      </Radio>)}
    </RadioGroup>
    <div className="notebook-icon-upload">
      <Button variant="secondary" disabled={blocked} onPress={() => fileInputRef.current?.click()}>
        {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
        <span>{pending ? "正在上传图片…" : "上传自定义图标"}</span>
      </Button>
      <input hidden ref={fileInputRef} id={uploadId} type="file" accept={NOTEBOOK_ICON_MIME_TYPES.join(",")} disabled={blocked} aria-label="上传自定义图标" onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
      <span className="notebook-icon-upload-hint">PNG、JPEG、WebP · 最大 2 MB</span>
    </div>
  </div>;
}
