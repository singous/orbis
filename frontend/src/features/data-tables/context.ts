import { createContext } from "react";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import type { TableResult } from "./api";
import type { OrbisBlock } from "../content/model/blocks";

export type PendingTableWriter={hasPending:()=>boolean;flush:()=>Promise<void>};

export type TableHost = {
  noteId: string;
  draftScope: string;
  auth: AuthRequestOptions | null;
  readOnly: boolean;
  canRecoverDraft?:boolean;
  registerWriter?:(blockId:string,writer:PendingTableWriter)=>()=>void;
  isCopyPending?:(blockId:string)=>boolean;
  shareToken?: string;
  documentVersion?:()=>number|undefined;
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
