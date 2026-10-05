import { createContext } from "react";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import type { TableResult } from "./api";
import type { OrbisBlock } from "../notes/block-model";

export type TableHost = {
  noteId: string;
  draftScope: string;
  auth: AuthRequestOptions | null;
  readOnly: boolean;
  shareToken?: string;
  transact?: (
    perform: (documentVersion: number) => Promise<TableResult>,
  ) => Promise<TableResult>;
  reload?: () => Promise<void>;
};
export const TableHostContext = createContext<TableHost | null>(null);

export function replaceTableBlock(
  blocks: OrbisBlock[],
  replacement: OrbisBlock,
): OrbisBlock[] {
  return blocks.map((block) =>
    block.id === replacement.id
      ? replacement
      : block.children.length
        ? { ...block, children: replaceTableBlock(block.children, replacement) }
        : block,
  );
}
