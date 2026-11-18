import { Spinner } from "@orbis/ui/spinner";
import {useState} from "react";
import {useInfiniteQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import {Button} from "@orbis/ui/button";
import {readPublicShare,type PublicShare} from "./api";
import {LIVE_REFRESH_INTERVAL_MS} from "./sharing-config";
type Props={manifest:PublicShare;token:string;selectedId?:string};
function Branch({manifest,token,selectedId,parentId}:{parentId?:string}&Props){
  const query=useInfiniteQuery({queryKey:["share-directory-branch",token,manifest.directory_version,parentId??null],initialPageParam:1,queryFn:({pageParam,signal})=>readPublicShare(token,signal,{parentId,page:pageParam,directoryVersion:manifest.directory_version}),getNextPageParam:last=>last.pagination.has_next?last.pagination.page+1:undefined,initialData:parentId?undefined:{pages:[manifest],pageParams:[1]},retry:false,refetchInterval: query => query.state.status === "error" ? false : LIVE_REFRESH_INTERVAL_MS});
  const pages=parentId?query.data?.pages??[]:[manifest,...query.data?.pages.slice(1)??[]];
  return <><ul className="m-0 list-none p-0">{pages.flatMap(page=>page.items).map(item=><Row key={item.id} item={item} manifest={manifest} token={token} selectedId={selectedId}/>)}</ul>
    {query.isPending?<p role="status">正在读取子目录…</p>:null}

    {query.hasNextPage?<Button size="sm" variant="ghost" onClick={event=>{event.stopPropagation();void query.fetchNextPage();}} disabled={query.isFetchingNextPage} focusableWhenDisabled={(query.isFetchingNextPage)} aria-busy={query.isFetchingNextPage || undefined}>{query.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}加载更多目录</Button>:null}
  </>;
}
function Row({item,...props}:{item:PublicShare["items"][number]}&Props){
  const[open,setOpen]=useState(false);
  return <li><div className="flex min-w-0 items-center gap-1"><Button size="icon-sm" aria-label={`${open?"收起":"展开"}${item.title}子目录`} aria-expanded={open} onClick={event=>{event.stopPropagation();setOpen(value=>!value);}} variant="ghost"><span aria-hidden="true">{open?"−":"+"}</span></Button><Link className="block min-w-0 flex-1 rounded-md px-[.65rem] py-[.55rem] text-[.9rem] wrap-anywhere text-foreground no-underline hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground" aria-current={item.id===props.selectedId?"page":undefined} to={`/share/${encodeURIComponent(props.token)}/${item.id}`}>{item.title}</Link></div>{open?<div className="ms-2 border-s border-border ps-4"><Branch {...props} parentId={item.id}/></div>:null}</li>;
}
export function ShareDirectory(props:Props){return <nav aria-label="分享文档目录"><Branch key={props.manifest.directory_version} {...props}/></nav>;}
