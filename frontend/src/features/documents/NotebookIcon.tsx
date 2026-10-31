import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { cn } from "../../shared/ui/cn";
import { getNotebookIcon } from "./notebook-icon-api";
import { DEFAULT_NOTEBOOK_ICON, NOTEBOOK_ICON_PRESETS, type NotebookIconColor, type NotebookIconValue } from "./notebook-icons";

export const NOTEBOOK_ICON_COLOR_CLASSES = {
  blue: "[--notebook-icon-fg:var(--ob-icon-blue)]",
  mint: "[--notebook-icon-fg:var(--ob-icon-mint)]",
  violet: "[--notebook-icon-fg:var(--ob-icon-violet)]",
  amber: "[--notebook-icon-fg:var(--ob-icon-amber)]",
  rose: "[--notebook-icon-fg:var(--ob-icon-rose)]",
  cyan: "[--notebook-icon-fg:var(--ob-icon-cyan)]",
  slate: "[--notebook-icon-fg:var(--ob-icon-slate)]",
} as const satisfies Record<NotebookIconColor, string>;

const iconFrameClassName = "notebook-icon inline-flex flex-none items-center justify-center overflow-hidden";
const iconSizeClasses = {
  sm: "notebook-icon--sm size-4.5 rounded-[5px] [&>svg]:size-3.5",
  md: "notebook-icon--md size-10 rounded-[11px] [&>svg]:size-5.5",
  lg: "notebook-icon--lg size-13 rounded-[14px] [&>svg]:size-7",
};

export type NotebookIconProps = {
  icon?: NotebookIconValue | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  previewUrl?: string;
};

function ImageIcon({ src, className, size = "md" }: { src: string; className?: string; size: NotebookIconProps["size"] }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NotebookIcon size={size} className={className} />;
  return <span className={cn(iconFrameClassName, "notebook-icon--image bg-(--ob-item-hover-bg) text-(--ob-icon-blue)", iconSizeClasses[size], className)}>
    <img className="size-full object-cover" alt="自定义笔记本图标" src={src} onError={() => setFailed(true)} />
  </span>;
}

function StoredImageIcon({ fileId, size, className }: { fileId: string; size: NotebookIconProps["size"]; className?: string }) {
  const auth = useOptionalAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const image = useQuery({
    queryKey: ["notebook-icon", sessionKey, fileId],
    queryFn: () => getNotebookIcon(fileId, { ...auth!, feedback: { error: false } }),
    meta: { silent: true },
    enabled: Boolean(auth),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!image.data) return <NotebookIcon size={size} className={className} />;
  return <ImageIcon key={image.data.data_url} src={image.data.data_url} size={size} className={className} />;
}

export function NotebookIcon({ icon, size = "md", className, previewUrl }: NotebookIconProps) {
  if (icon?.type === "image") {
    return previewUrl
      ? <ImageIcon key={previewUrl} src={previewUrl} size={size} className={className} />
      : <StoredImageIcon key={icon.asset_id} fileId={icon.asset_id} size={size} className={className} />;
  }
  const selected = icon ?? DEFAULT_NOTEBOOK_ICON;
  const Icon = NOTEBOOK_ICON_PRESETS.find((preset) => preset.name === selected.name)?.Icon ?? NOTEBOOK_ICON_PRESETS[0].Icon;
  return (
    <span aria-hidden="true" className={cn(iconFrameClassName, `notebook-icon--${selected.color}`, NOTEBOOK_ICON_COLOR_CLASSES[selected.color], iconSizeClasses[size], "bg-[color-mix(in_oklab,var(--notebook-icon-fg)_13%,var(--ob-surface))] text-[color:var(--notebook-icon-fg)]", className)}>
      <Icon strokeWidth={1.8} />
    </span>
  );
}
