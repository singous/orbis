import {useState} from "react";
import {useInfiniteQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import {Button} from "../../shared/ui/Button";
import {IconButton} from "../../shared/ui/IconButton";
import {readPublicShare,type PublicShare} from "./api";
import {LIVE_REFRESH_INTERVAL_MS} from "./sharing-config";
type Props={manifest:PublicShare;token:string;selectedId?:string};
function Branch({manifest,token,selectedId,parentId}:{parentId?:string}&Props){
  const query=useInfiniteQuery({queryKey:["share-directory-branch",token,manifest.directory_version,parentId??null],initialPageParam:1,queryFn:({pageParam,signal})=>readPublicShare(token,signal,{parentId,page:pageParam,directoryVersion:manifest.directory_version}),getNextPageParam:last=>last.pagination.has_next?last.pagination.page+1:undefined,initialData:parentId?undefined:{pages:[manifest],pageParams:[1]},retry:false,refetchInterval: query => query.state.status === "error" ? false : LIVE_REFRESH_INTERVAL_MS});
  const pages=parentId?query.data?.pages??[]:[manifest,...query.data?.pages.slice(1)??[]];
  return <><ul>{pages.flatMap(page=>page.items).map(item=><Row key={item.id} item={item} manifest={manifest} token={token} selectedId={selectedId}/>)}</ul>
    {query.isPending?<p role="status">正在读取子目录…</p>:null}

    {query.hasNextPage?<Button size="sm" variant="ghost" isPending={query.isFetchingNextPage} onPress={()=>void query.fetchNextPage()}>加载更多目录</Button>:null}
  </>;
}
function Row({item,...props}:{item:PublicShare["items"][number]}&Props){
  const[open,setOpen]=useState(false);
  return <li><div className="public-share-directory-row"><IconButton size="sm" aria-label={`${open?"收起":"展开"}${item.title}子目录`} aria-expanded={open} onPress={()=>setOpen(value=>!value)}><span aria-hidden="true">{open?"−":"+"}</span></IconButton><Link aria-current={item.id===props.selectedId?"page":undefined} to={`/share/${encodeURIComponent(props.token)}/${item.id}`}>{item.title}</Link></div>{open?<Branch {...props} parentId={item.id}/>:null}</li>;
}
export function ShareDirectory(props:Props){return <nav aria-label="分享文档目录"><Branch key={props.manifest.directory_version} {...props}/></nav>;}
