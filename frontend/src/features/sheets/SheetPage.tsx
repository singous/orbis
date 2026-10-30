import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { DocumentShell } from "../documents/DocumentShell";
import { sheetAPI } from "./api";

/** Preserve legacy sheet URLs while the document route owns the editor. */
export function SheetPage() {
  const { sheetId = "" } = useParams();
  const auth = useAuthRequest();
  const [params] = useSearchParams();
  const meta = useQuery({
    queryKey: ["sheets", auth.workspaceId, sheetId, "meta"],
    queryFn: ({ signal }) => sheetAPI(auth).get(sheetId, signal),
  });
  if (meta.data)
    return (
      <Navigate
        replace
        to={`/documents/${meta.data.document_id}${params.size ? `?${params}` : ""}`}
      />
    );
  return (
    <DocumentShell>
      <div className="sheet-empty">
        {meta.error?.message ?? "正在打开数据表…"}
      </div>
    </DocumentShell>
  );
}
