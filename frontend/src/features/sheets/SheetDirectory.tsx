import { useInfiniteQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { ActionButton } from "../../shared/ui/ActionButton";
import { sheetAPI } from "./api";
export function SheetDirectory({ collectionId }: { collectionId: string }) {
  const auth = useAuthRequest(),
    api = useMemo(() => sheetAPI(auth), [auth]);
  const query = useInfiniteQuery({
    queryKey: ["sheet-directory", auth.workspaceId, collectionId],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api.list(collectionId, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
  return (
    <div className="sheet-directory">
      <NavLink
        to={`/sheets?collection=${collectionId}`}
        className="workspace-function-link"
      >
        <Table2 size={16} />
        多维表格
      </NavLink>
      {query.data?.pages
        .flatMap((p) => p.items)
        .map((item) => (
          <NavLink
            key={item.id}
            to={`/sheets/${item.id}`}
            className={({ isActive }) =>
              `workspace-function-link${isActive ? " is-active" : ""}`
            }
          >
            <Table2 size={15} />
            <span className="truncate">{item.title}</span>
          </NavLink>
        ))}
      {query.hasNextPage && (
        <ActionButton
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          更多数据表
        </ActionButton>
      )}
    </div>
  );
}
