import {
  BookOpen, Notebook, Folder, FileText, Lightbulb, Code2, Palette, Rocket,
  FlaskConical, Globe2, GraduationCap, Heart, BriefcaseBusiness, Target, Coffee, Music,
  type LucideIcon,
} from "lucide-react";

import type { NotebookIconColor, NotebookIconName, NotebookIconValue } from "../../shared/api/schemas";

export type { NotebookIconColor, NotebookIconName, NotebookIconValue } from "../../shared/api/schemas";

export const DEFAULT_NOTEBOOK_ICON = { type: "preset", name: "book", color: "blue" } as const satisfies NotebookIconValue;

export const NOTEBOOK_ICON_PRESETS: Array<{ name: NotebookIconName; label: string; Icon: LucideIcon }> = [
  { name: "book", label: "书本", Icon: BookOpen },
  { name: "notebook", label: "笔记", Icon: Notebook },
  { name: "folder", label: "文件夹", Icon: Folder },
  { name: "file-text", label: "文档", Icon: FileText },
  { name: "lightbulb", label: "灵感", Icon: Lightbulb },
  { name: "code", label: "代码", Icon: Code2 },
  { name: "palette", label: "设计", Icon: Palette },
  { name: "rocket", label: "火箭", Icon: Rocket },
  { name: "flask", label: "实验", Icon: FlaskConical },
  { name: "globe", label: "世界", Icon: Globe2 },
  { name: "graduation-cap", label: "学习", Icon: GraduationCap },
  { name: "heart", label: "喜爱", Icon: Heart },
  { name: "briefcase", label: "工作", Icon: BriefcaseBusiness },
  { name: "target", label: "目标", Icon: Target },
  { name: "coffee", label: "生活", Icon: Coffee },
  { name: "music", label: "音乐", Icon: Music },
];

export const NOTEBOOK_ICON_COLORS: Array<{ name: NotebookIconColor; label: string }> = [
  { name: "blue", label: "湖蓝色" },
  { name: "mint", label: "薄荷绿" },
  { name: "violet", label: "紫罗兰" },
  { name: "amber", label: "琥珀黄" },
  { name: "rose", label: "玫瑰粉" },
  { name: "cyan", label: "青蓝色" },
  { name: "slate", label: "石板灰" },
];

export const NOTEBOOK_ICON_MAX_BYTES = 2 * 1024 * 1024;
export const NOTEBOOK_ICON_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function validateNotebookIconFile(file: File): string | null {
  if (!NOTEBOOK_ICON_MIME_TYPES.includes(file.type)) return "请选择 PNG、JPEG 或 WebP 图片。";
  if (file.size > NOTEBOOK_ICON_MAX_BYTES) return "图片大小不能超过 2 MB。";
  if (!file.size) return "图片内容为空，请重新选择。";
  return null;
}
