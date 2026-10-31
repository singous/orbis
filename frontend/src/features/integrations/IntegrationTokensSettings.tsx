import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { apiRequest,workspacePath } from "../../shared/api/api-client";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { authRequestOptions, useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";

type IntegrationToken = {
  id: string; name: string; permissions: string[]; secret_prefix: string;
  collection_id: string | null; document_id: string | null;version:number;
  expires_at_ms: number | null; revoked_at_ms: number | null;
  last_used_at_ms: number | null;
};

export function IntegrationTokensSettings() {
  const sessionKey = useStore(authStore, getAuthSessionKey);
  return <IntegrationTokensScope key={sessionKey} />;
}

function IntegrationTokensScope() {
  const auth = useAuthRequest();
  const workspace = useStore(authStore, state => state.workspace);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const currentKey = useRef(sessionKey);
  currentKey.current = sessionKey;
  const [page,setPage]=useState(1);
  const [hasMore,setHasMore]=useState(false);
  const previousScope=useRef<string|null>(null);
  const listGeneration=useRef(0);
  const [items, setItems] = useState<IntegrationToken[]>([]);
  const [name, setName] = useState("");
  const [permission, setPermission] = useState("read");
  const [scope, setScope] = useState("workspace");
  const [scopeId, setScopeId] = useState("");
  const [media, setMedia] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [days, setDays] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const canWrite = ["owner", "admin", "editor"].includes(workspace?.role ?? "");
  async function refresh(key = sessionKey,requestedPage=page) {
    const generation=++listGeneration.current;
    const data = await apiRequest<{ items: IntegrationToken[];pagination:{page:number;page_size:number;total:number} }>(workspacePath(auth,`/integration-tokens?page=${requestedPage}&page_size=20`), authRequestOptions(auth));
    if (currentKey.current === key && generation===listGeneration.current) {setItems(data.items);setHasMore(data.pagination.page*data.pagination.page_size<data.pagination.total);}
  }
  useEffect(() => {
    currentKey.current = sessionKey;
    if(previousScope.current!==sessionKey){setPending(false);setSecret(null);previousScope.current=sessionKey;}
    setItems([]);
    void refresh().catch(error => { if (currentKey.current === sessionKey) reportError(error); });
    return () => { currentKey.current = ""; };
  }, [sessionKey, auth.workspaceId,page]);
  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);  setSecret(null);
    const key = sessionKey;
    try {
      const data = await apiRequest<{credential:IntegrationToken;token:string}>(workspacePath(auth,"/integration-tokens"), {
        ...authRequestOptions(auth), method: "POST", body: {
          name, permissions: [...(permission === "write" ? ["documents:read", "documents:write"] : ["documents:read"]), ...(media ? permission === "write" ? ["assets:read", "assets:write"] : ["assets:read"] : []), ...(sharing && scope !== "note" && canWrite ? ["shares:manage"] : [])],
          collection_id: scope === "notebook" ? scopeId : null,
          document_id: scope === "note" ? scopeId : null,
          expires_in_days: Number(days),
        },
      });
      if (currentKey.current !== key) return;
      setSecret(data.token); setName("");
      setPage(1);await refresh(key,1);
    } catch (error) { if (currentKey.current === key) reportError(error); }
    finally { if (currentKey.current === key) setPending(false); }
  }
  async function revoke(item:IntegrationToken) {
    const key = sessionKey;
    setPending(true);
    try {
      await apiRequest(workspacePath(auth,`/integration-tokens/${item.id}/revoke`), { ...authRequestOptions(auth), method: "POST",body:{expected_version:item.version} });
      if (currentKey.current === key) { setSecret(null); await refresh(key); }
    } catch (error) { if (currentKey.current === key) reportError(error); }
    finally { if (currentKey.current === key) setPending(false); }
  }
  return <section className="workbench-settings-section" aria-labelledby="integration-tokens-title">
    <h2 id="integration-tokens-title">智能体与远程文档库</h2>
    <p>通过 Orbis CLI 将当前工作空间接入可以执行命令的智能体。令牌权限同时受你的当前成员角色约束，撤销后立即停止访问。</p>

    <form className="profile-edit-form" onSubmit={create}>
      <TextInput label="令牌名称" required maxLength={120} value={name} disabled={pending} onChange={event => setName(event.target.value)} placeholder="例如：我的写作助手" />
      <SelectField label="权限" value={permission} disabled={pending} onChange={setPermission} options={[{ value: "read", label: "只读文档" }, ...(canWrite ? [{ value: "write", label: "读取与编辑文档" }] : [])]} />
      <SelectField label="授权范围" value={scope} disabled={pending} onChange={setScope} options={[{ value: "workspace", label: `当前工作空间：${workspace?.name ?? "我的空间"}` }, { value: "notebook", label: "一个笔记本内的所有文档" }, { value: "note", label: "仅一篇文档" }]} />
      {scope !== "workspace" ? <TextInput label={scope === "note" ? "文档 ID" : "笔记本 ID"} required value={scopeId} disabled={pending} onChange={event => setScopeId(event.target.value)} /> : null}
      {scope !== "workspace" ? <p>{scope === "note" ? "仅授权这篇文档，不包含下级文档。" : "包含此笔记本当前与后续新增文档。"}</p> : null}
      <label><input type="checkbox" checked={media} disabled={pending} onChange={event => setMedia(event.target.checked)} /> 允许读取附件（编辑权限同时允许上传附件）</label>
      {canWrite && scope !== "note" ? <label><input type="checkbox" checked={sharing} disabled={pending} onChange={event => setSharing(event.target.checked)} /> 允许创建与撤销实时公开分享，范围包含未来子文档</label> : null}
      <TextInput label="有效期（天）" type="number" min={1} max={365} required value={days} disabled={pending} onChange={event => setDays(event.target.value)} />
      <Button type="submit" variant="primary" disabled={pending || !name.trim()} isPending={pending}>生成集成令牌</Button>
    </form>
    {secret ? <div role="status" className="profile-field">
      <p>请现在保存令牌。关闭后无法再次查看原文。使用环境变量 ORBIS_TOKEN 或通过 orbis auth login --token-stdin 存入系统凭据库。</p>
      <TextInput aria-label="新集成令牌" readOnly value={secret} />
      <div className="profile-form-actions"><Button onPress={() => { if(!navigator.clipboard){reportError("浏览器不支持自动复制，请手动复制令牌");return;}void navigator.clipboard.writeText(secret).catch(() => reportError("复制失败，请手动复制令牌")); }}>复制令牌</Button><Button variant="ghost" onPress={() => setSecret(null)}>已保存，关闭原文</Button></div>
      <p>工作空间 ID：<code>{auth.workspaceId}</code></p>
    </div> : null}
    <ul className="workbench-settings-list" aria-label="已创建的集成令牌">
      {items.map(item => <li key={item.id}>
        <strong>{item.name}</strong> <code>{item.secret_prefix}…</code>
        <p>{item.permissions.includes("documents:write") ? "读取与编辑" : "只读"} · {item.document_id ? "单篇文档" : item.collection_id ? "限定笔记本" : "当前工作空间"} · {item.revoked_at_ms ? "已撤销" : item.expires_at_ms && item.expires_at_ms <= Date.now() ? "已过期" : "有效"}</p>
        {!item.revoked_at_ms ? <Button size="sm" variant="ghost" disabled={pending} onPress={() => void revoke(item)}>撤销</Button> : null}
      </li>)}
    </ul>
    {!items.length ? <p>本页暂无集成令牌。</p> : null}
    <div className="profile-form-actions"><Button disabled={page<=1||pending} onPress={()=>setPage(value=>value-1)}>上一页令牌</Button><span>第 {page} 页</span><Button disabled={!hasMore||pending} onPress={()=>setPage(value=>value+1)}>下一页令牌</Button></div>
  </section>;
}
