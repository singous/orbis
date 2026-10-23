import { useEffect, useRef, useState } from "react";
import { Shapes } from "lucide-react";
import { type BoardViewData } from "./public-contract";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { ActionButton } from "../../shared/ui/ActionButton";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { createManagedFiles } from "../files/managed-files";
import "./board-preview.css";
const privateImage =
  /href="\/api\/v1\/workspaces\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\/content"/g;
export function BoardView({ view }: { view: BoardViewData }) {
  const [open, setOpen] = useState(false);
  const auth = useOptionalAuthRequest(),
    authRef = useRef(auth);
  authRef.current = auth;
  const [resolved, setResolved] = useState<{
    source: string;
    svg: string;
  } | null>(null);
  const [error, setError] = useState("");
  const needsAssets = Array.from(view.svg.matchAll(privateImage));
  useEffect(() => {
    const matches = Array.from(view.svg.matchAll(privateImage));
    setError("");
    if (!matches.length) return;
    const files = createManagedFiles(() => authRef.current);
    let active = true;
    void (async () => {
      const urls = new Map<string, string>();
      for (const match of matches) {
        if (match[1] !== authRef.current?.workspaceId)
          throw new Error("画板图片需要当前工作空间的访问权限。");
        urls.set(match[2], await files.resolve("orbis-file:" + match[2]));
      }
      if (active)
        setResolved({
          source: view.svg,
          svg: view.svg.replace(
            privateImage,
            (_all, _workspace: string, id: string) => `href="${urls.get(id)}"`,
          ),
        });
    })().catch((error: unknown) => {
      if (active)
        setError(error instanceof Error ? error.message : "图片读取失败。");
    });
    return () => {
      active = false;
      files.dispose();
    };
  }, [view.svg, auth?.workspaceId, auth?.accessToken]);
  if (view.restricted)
    return (
      <div className="board-preview-empty">
        <Shapes size={28} />
        <p>该画板需要工作空间访问权限。</p>
      </div>
    );
  // This dedicated DTO contains only server-generated SVG, never an authored HTML field.
  const content = (
    <div
      className="board-public-svg"
      role="img"
      aria-label={view.title}
      dangerouslySetInnerHTML={{
        __html: needsAssets.length
          ? resolved?.source === view.svg
            ? resolved.svg
            : ""
          : view.svg,
      }}
    />
  );
  return (
    <figure className="board-embed">
      <header>
        <Shapes size={16} />
        <strong>{view.title}</strong>
        <span className="board-embed-spacer" />
        <ActionButton onClick={() => setOpen(true)}>放大查看</ActionButton>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {content}
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={view.title} className="board-preview-dialog">
            <div className="board-expanded-preview">{content}</div>
          </DialogContent>
        </Dialog>
      ) : null}
    </figure>
  );
}
