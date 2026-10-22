import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = JSON.parse(
  await readFile(
    new URL("node_modules/@iconify-json/tabler/icons.json", root),
    "utf8",
  ),
);
const info = JSON.parse(
  await readFile(
    new URL("node_modules/@iconify-json/tabler/info.json", root),
    "utf8",
  ),
);
const directory = new URL("public/board-icons/tabler-1.2.42/", root);
const groups = new Map();
const entries = [];
const vocabulary = {
  server: "服务器 主机 服务",
  database: "数据库 数据 存储",
  cloud: "云 服务 云端",
  device: "设备 电脑 手机",
  user: "用户 人员 成员",
  users: "团队 人员 群组",
  file: "文件 文档",
  folder: "文件夹 目录",
  chart: "图表 统计 数据",
  arrow: "箭头 方向",
  mail: "邮件 信件",
  message: "消息 对话 聊天",
  lock: "锁 安全 权限",
  shield: "安全 防护",
  network: "网络 拓扑",
  settings: "设置 配置",
  search: "搜索 查询",
  brand: "品牌 软件",
  code: "代码 开发",
  api: "接口 API",
  git: "代码 版本",
  world: "网络 世界",
  building: "建筑 组织 公司",
  calendar: "日期 日历",
  clock: "时钟 时间",
  shopping: "购物 电商 订单",
  credit: "支付 账户",
  home: "首页 房屋",
  photo: "图片 照片",
  heart: "心 收藏 喜欢",
  star: "星 收藏",
  tool: "工具",
  table: "表格 数据",
  layout: "布局 窗口",
  map: "地图 位置",
  key: "密钥 钥匙",
};
for (const [id, icon] of Object.entries(source.icons).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  // The canvas catalog deliberately excludes icons requiring references or embedded content.
  if (
    /<(?:script|foreignObject|image|use)\b|\bon\w+\s*=|(?:href|url)\s*[=(]/i.test(
      icon.body,
    )
  )
    continue;
  const shard = id.slice(0, 1);
  const group = groups.get(shard) ?? {};
  group[id] = {
    ...icon,
    width: icon.width ?? source.width ?? 24,
    height: icon.height ?? source.height ?? 24,
  };
  groups.set(shard, group);
  entries.push({
    id,
    keywords: [
      ...new Set(
        id.split("-").flatMap((part) => vocabulary[part]?.split(" ") ?? []),
      ),
    ].join(" "),
    shard,
  });
}
await mkdir(directory, { recursive: true });
const shards = {};
for (const [shard, icons] of groups) {
  const body = JSON.stringify(icons);
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const file = shard + "." + hash + ".json";
  await writeFile(new URL(file, directory), body);
  shards[shard] = file;
}
await writeFile(
  new URL("index.json", directory),
  JSON.stringify({
    version: "1.2.42",
    author: info.author,
    license: info.license,
    count: entries.length,
    shards,
    items: entries,
  }),
);
console.log(
  "Prepared " +
    entries.length +
    " self-hosted board icons at " +
    fileURLToPath(directory),
);

const canonical = JSON.parse(
  await readFile(new URL("../api/board-icons.json", root), "utf8"),
);
const generated = Object.assign({}, ...groups.values());
if (
  canonical.version !== "tabler-1.2.42" ||
  Object.keys(canonical.icons).length !== entries.length ||
  Object.entries(generated).some(
    ([id, icon]) =>
      canonical.icons[id]?.body !== icon.body ||
      canonical.icons[id]?.width !== icon.width ||
      canonical.icons[id]?.height !== icon.height,
  )
)
  throw new Error("Board icon contract differs from pinned frontend assets");
