export type IconEntry = { id: string; keywords: string; shard: string };
type IconIndex = {
  count: number;
  items: IconEntry[];
  shards: Record<string, string>;
};
type IconData = { body: string; width: number; height: number };
const BASE = `${import.meta.env.BASE_URL}board-icons/tabler-1.2.42/`;
const IMAGE_CACHE_LIMIT = 256;
let indexPromise: Promise<IconIndex> | null = null;
const shards = new Map<string, Promise<Record<string, IconData>>>();
const images = new Map<string, Promise<HTMLImageElement>>();
export function iconIndex(): Promise<IconIndex> {
  indexPromise ??= fetch(BASE + "index.json")
    .then((response) => {
      if (!response.ok) throw new Error("图标库读取失败，请重试。");
      return response.json() as Promise<IconIndex>;
    })
    .catch((error) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}
export async function iconData(id: string): Promise<IconData> {
  if (!/^[a-z0-9-]{1,100}$/.test(id)) throw new Error("图标标识无效。");
  const index = await iconIndex(),
    shard = id[0],
    file = index.shards[shard];
  if (!file) throw new Error("图标不存在。");
  if (!shards.has(shard))
    shards.set(
      shard,
      fetch(BASE + file)
        .then((response) => {
          if (!response.ok) throw new Error("图标读取失败，请重试。");
          return response.json();
        })
        .catch((error) => {
          shards.delete(shard);
          throw error;
        }),
    );
  const data = (await shards.get(shard)!)[id];
  if (!data) throw new Error("图标不存在。");
  return data;
}
export function iconImage(
  id: string,
  color: string,
): Promise<HTMLImageElement> {
  const key = id + ":" + color;
  if (images.has(key)) return images.get(key)!;
  if (images.size >= IMAGE_CACHE_LIMIT)
    images.delete(images.keys().next().value!);
  const promise = iconData(id)
    .then(
      (data) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#334155";
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${data.width}" height="${data.height}" viewBox="0 0 ${data.width} ${data.height}" color="${safeColor}">${data.body}</svg>`;
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("图标无法显示。"));
          image.src =
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        }),
    )
    .catch((error) => {
      images.delete(key);
      throw error;
    });
  images.set(key, promise);
  return promise;
}
