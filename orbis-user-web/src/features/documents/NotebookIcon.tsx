import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { cn } from "../../shared/ui/cn";
import { getNotebookIcon } from "./notebook-icon-api";
import { DEFAULT_NOTEBOOK_ICON, NOTEBOOK_ICON_PRESETS, type NotebookIconValue } from "./notebook-icons";

export type NotebookIconProps = {
  icon?: NotebookIconValue | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  previewUrl?: string;
};

function ImageIcon({ src, className, size }: { src: string; className?: string; size: NotebookIconProps["size"] }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NotebookIcon size={size} className={className} />;
  return <span className={cn("notebook-icon notebook-icon--image", `notebook-icon--${size}`, className)}>
    <img alt="自定义笔记本图标" src={src} onError={() => setFailed(true)} />
  </span>;
}

function StoredImageIcon({ fileId, size, className }: { fileId: string; size: NotebookIconProps["size"]; className?: string }) {
  const auth = useOptionalAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const image = useQuery({
    queryKey: ["notebook-icon", sessionKey, fileId],
    queryFn: () => getNotebookIcon(fileId, auth!),
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
      : <StoredImageIcon key={icon.file_id} fileId={icon.file_id} size={size} className={className} />;
  }
  const selected = icon ?? DEFAULT_NOTEBOOK_ICON;
  const Icon = NOTEBOOK_ICON_PRESETS.find((preset) => preset.name === selected.name)?.Icon ?? NOTEBOOK_ICON_PRESETS[0].Icon;
  return (
    <span aria-hidden="true" className={cn("notebook-icon", `notebook-icon--${selected.color}`, `notebook-icon--${size}`, className)}>
      <Icon strokeWidth={1.8} />
    </span>
  );
}
