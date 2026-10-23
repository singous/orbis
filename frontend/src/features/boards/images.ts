import { apiBlobRequest, workspacePath } from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
const CACHE_SIZE = 32,
  MAX_EDGE = 1024,
  MAX_PENDING = 128,
  CONCURRENCY = 4;
/** One editor owns bounded image requests and decoded previews. */
export class BoardImages {
  private controller = new AbortController();
  private cache = new Map<string, Promise<HTMLCanvasElement>>();
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private auth: () => AuthRequestOptions) {}
  load = (id: string): Promise<HTMLCanvasElement> => {
    if (this.controller.signal.aborted)
      return Promise.reject(
        new DOMException("Image owner closed", "AbortError"),
      );
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (this.queue.length >= MAX_PENDING)
      return Promise.reject(new Error("图片较多，请稍后重新查看。"));
    if (this.cache.size >= CACHE_SIZE)
      this.cache.delete(this.cache.keys().next().value!);
    const promise = new Promise<HTMLCanvasElement>((resolve, reject) => {
      const run = async () => {
        this.active++;
        try {
          if (this.controller.signal.aborted)
            throw new DOMException("Image owner closed", "AbortError");
          const auth = this.auth(),
            blob = await apiBlobRequest(
              workspacePath(auth, `/assets/${id}/content`),
              { ...authRequestOptions(auth), signal: this.controller.signal },
            );
          const bitmap = await createImageBitmap(blob);
          try {
            if (this.controller.signal.aborted)
              throw new DOMException("Image owner closed", "AbortError");
            const scale = Math.min(
                1,
                MAX_EDGE / Math.max(bitmap.width, bitmap.height),
              ),
              canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas
              .getContext("2d")!
              .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            resolve(canvas);
          } finally {
            bitmap.close();
          }
        } catch (error) {
          this.cache.delete(id);
          reject(error);
        } finally {
          this.active--;
          this.queue.shift()?.();
        }
      };
      if (this.active < CONCURRENCY) void run();
      else this.queue.push(() => void run());
    });
    this.cache.set(id, promise);
    return promise;
  };
  dispose() {
    this.controller.abort();
    this.cache.clear();
    while (this.queue.length) this.queue.shift()?.();
  }
}
