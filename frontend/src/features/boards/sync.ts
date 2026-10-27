import { z } from "zod";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { changeSchema, type Change } from "./model";
const wire = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), protocol_version: z.literal(1) }),
  z.object({
    type: z.literal("changes"),
    data: z.object({
      items: z.array(changeSchema).max(50),
      revision: z.number().int(),
      has_more: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    status: z.number(),
    code: z.string(),
    message: z.string(),
  }),
]);
const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 4 * 1024 * 1024 + 64 * 1024;

/** A resumable notification transport; operation submission remains in BoardSession. */
export function connectBoard(
  id: string,
  after: number,
  auth: AuthRequestOptions,
  callbacks: {
    changes: (items: Change[]) => void;
    ready: () => void;
    closed: () => void;
  },
): () => void {
  const url = new URL(
    `/api/v1/workspaces/${auth.workspaceId}/boards/${id}/sync`,
    location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url.href, "orbis.board.v1");
  let active = true;
  const timeout = setTimeout(() => socket.close(), CONNECTION_TIMEOUT_MS);
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        type: "authenticate",
        protocol_version: 1,
        token: auth.accessToken,
        after_version: after,
      }),
    );
  socket.onmessage = (event) => {
    if (!active) return;
    try {
      if (typeof event.data !== "string" || event.data.length > MAX_FRAME_BYTES)
        throw Error("Invalid board stream");
      const message = wire.parse(JSON.parse(event.data));
      if (message.type === "ready") {
        clearTimeout(timeout);
        callbacks.ready();
      } else if (message.type === "changes")
        callbacks.changes(message.data.items);
      else socket.close();
    } catch {
      socket.close();
    }
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    clearTimeout(timeout);
    if (active) {
      active = false;
      callbacks.closed();
    }
  };
  return () => {
    active = false;
    clearTimeout(timeout);
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  };
}
