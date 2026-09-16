import { createContext, type ReactNode } from "react";
import { useManagedFiles } from "./use-managed-files";

export const FileContentContext = createContext<{ scope: string; resolve: (value: string) => Promise<string> } | null>(null);

/** Private resources are opt-in for authenticated editing and preview surfaces. */
export function AuthenticatedFileContent({ children }: { children: ReactNode }) {
  const files = useManagedFiles();
  return <FileContentContext.Provider value={files}>{children}</FileContentContext.Provider>;
}
