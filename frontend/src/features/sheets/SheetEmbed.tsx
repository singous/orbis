import { reportError } from "../../shared/api/request-feedback";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { TableHostContext } from "../data-tables/context";
import { getNote } from "../documents/api";
import { sheetAPI } from "./api";
import { SheetWorkspace } from "./SheetPage";
import "./sheets.css";

export function SheetEmbed({
  id,
  blockId,
  viewId = "",
  onBind,
  readOnly = false,
}: {
  id?: string;
  blockId?: string;
  viewId?: string;
  onBind?: (id: string, view: string) => void;
  readOnly?: boolean;
}) {
  const auth = useOptionalAuthRequest();
  const host = useContext(TableHostContext);
  const intent = useRef(blockId || newUUID());
  const binding = useRef(onBind);
  binding.current = onBind;
  const running = useRef(false),
    mounted = useRef(true);
  const [error, setError] = useState("");
  const owner = useQuery({
    queryKey: ["note", host?.noteId],
    queryFn: ({ signal }) => getNote(host!.noteId, auth!, signal),
    enabled: !!host?.noteId && !!auth && !id,
  });
  async function create() {
    if (running.current || !auth || !owner.data || readOnly || id) return;
    running.current = true;
    setError("");
    try {
      const sheet = await sheetAPI(auth).create({
        id: intent.current,
        document_id: owner.data.id,
        collection_id: owner.data.collection_id,
        title: "数据表",
        template: "",
      });
      if (mounted.current)
        binding.current?.(sheet.id, sheet.definition.views[0].id);
    } catch (e) { reportError(e);
      if (mounted.current) setError((e as Error).message);
    } finally {
      running.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!id && owner.data && !readOnly) void create();
  }, [id, owner.data, readOnly]);
  if (!auth)
    return <div className="sheet-embed">请登录工作空间查看数据表。</div>;
  if (!id)
    return (
      <div className="sheet-embed" contentEditable={false}>
        {error || owner.error?.message ? (
          <>

            <ActionButton size="sm" onClick={() => void create()}>
              重试创建数据表
            </ActionButton>
          </>
        ) : (
          <p>{readOnly ? "尚未创建数据表" : "正在创建数据表…"}</p>
        )}
      </div>
    );
  return (
    <div className="sheet-embed sheet-embed-editor" contentEditable={false}>
      <SheetWorkspace
        key={id}
        id={id}
        initialView={viewId}
        embedKey={blockId}
        embedded
        readOnly={readOnly || host?.readOnly}
        onViewChange={
          readOnly || host?.readOnly ? undefined : (view) => onBind?.(id, view)
        }
      />
    </div>
  );
}
