import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClasses = extendTailwindMerge({
  extend: { theme: { radius: ["ob-sm", "ob-md", "ob-lg", "ob-xl"], text: ["ob-caption"] } },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
