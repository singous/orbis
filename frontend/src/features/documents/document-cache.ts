import type {QueryClient} from "@tanstack/react-query";
import type {Note,NoteTreeItem} from "../../shared/api/schemas";

type Commit={document_id:string;content_version:number;title?:string|null};
/** Only an acknowledged commit may advance cached metadata without a fresh read. */
export function cacheDocumentCommit(client:QueryClient,commit:Commit){
  const metadata=client.getQueryData<Note>(["note",commit.document_id]);
  if(metadata){
    const update=(items:NoteTreeItem[]):NoteTreeItem[]=>items.map(item=>item.id===commit.document_id
      ? item.content_version>commit.content_version?item:{...item,content_version:commit.content_version,title:commit.title??item.title}
      : {...item,children:update(item.children)});
    client.setQueryData<{items:NoteTreeItem[]}>(["note-tree",metadata.collection_id],tree=>tree?{...tree,items:update(tree.items)}:tree);
    if(metadata.content_version<=commit.content_version)client.setQueryData<Note>(["note",commit.document_id],{...metadata,content_version:commit.content_version,title:commit.title??metadata.title});
  }
}
