import { portPosition } from "./geometry";
import { makeElement, type Element, type Member } from "./model";
export type Template = {
  id: string;
  category: string;
  name: string;
  description: string;
  build: (page: string) => Element[];
};
type Context = {
  elements: Element[];
  node: (
    shape: string,
    label: string,
    x: number,
    y: number,
    parent?: Element,
  ) => Element;
  edge: (
    a: Element,
    b: Element,
    label?: string,
    startPort?: string,
    endPort?: string,
  ) => Element;
};
function context(page: string): Context {
  const elements: Element[] = [];
  return {
    elements,
    node(shape, label, x, y, parent) {
      const element = makeElement(shape, page, x, y);
      element.text = label;
      element.structure.parent_id = parent?.id ?? null;
      element.structure.order = elements.length;
      elements.push(element);
      return element;
    },
    edge(a, b, label = "", startPort = "right", endPort = "left") {
      const element = makeElement("connector", page, 0, 0);
      element.structure.start = {
        element_id: a.id,
        port: startPort,
        x: 0,
        y: 0,
      };
      element.structure.end = { element_id: b.id, port: endPort, x: 0, y: 0 };
      element.text = label;
      element.structure.order = elements.length;
      elements.push(element);
      return element;
    },
  };
}
function members(names: Array<[string, string, string?]>): Member[] {
  return names.map(([name, type, key]) => ({
    id: crypto.randomUUID(),
    name,
    type,
    key: (key ?? "") as Member["key"],
  }));
}
function flow(page: string, labels: string[]) {
  const c = context(page),
    nodes = labels.map((label, i) =>
      c.node(
        i === 0 || i === labels.length - 1
          ? "flow.start"
          : i === 2
            ? "flow.decision"
            : "flow.process",
        label,
        100 + i * 240,
        220,
      ),
    );
  nodes.forEach((node, i) => {
    if (i) c.edge(nodes[i - 1], node, i === 3 ? "通过" : "");
  });
  const retry = c.node(
    "flow.process",
    "补充信息与重试",
    nodes[2].geometry.x,
    440,
  );
  c.edge(nodes[2], retry, "未通过", "bottom", "top");
  c.edge(retry, nodes[1], "重新处理", "left", "bottom");
  return c.elements;
}
function mindmap(page: string, title: string, branches: string[]) {
  const c = context(page),
    root = c.node("mindmap.root", title, 100, 280);
  root.style = {
    ...root.style,
    fill: "#dbeafe",
    stroke: "#3b82f6",
    bold: true,
  };
  branches.forEach((label, i) => {
    const branch = c.node("mindmap.topic", label, 400, 60 + i * 180, root);
    c.edge(root, branch);
    for (let j = 0; j < 2; j++) {
      const child = c.node(
        "mindmap.subtopic",
        ["目标与说明", "具体行动"][j],
        700,
        40 + i * 180 + j * 85,
        branch,
      );
      child.geometry.height = 60;
      c.edge(branch, child);
    }
  });
  return c.elements;
}
function architecture(page: string, title: string, kind: string) {
  const c = context(page);
  const boundary = c.node("architecture.boundary", title, 340, 40);
  boundary.geometry = { ...boundary.geometry, width: 1040, height: 680 };
  const client = c.node("architecture.client", "Web / 移动端", 60, 260);
  const gateway = c.node(
    "architecture.gateway",
    kind === "deployment" ? "负载均衡" : "API 网关",
    400,
    260,
    boundary,
  );
  gateway.structure.icon_id = "route";
  c.edge(client, gateway, "HTTPS");
  if (kind === "three-tier") {
    const app = c.node("architecture.service", "业务应用", 710, 260, boundary);
    const db = c.node(
      "architecture.database",
      "PostgreSQL",
      1080,
      160,
      boundary,
    );
    const cache = c.node(
      "architecture.cache",
      "Redis 缓存",
      1080,
      400,
      boundary,
    );
    c.edge(gateway, app, "请求");
    c.edge(app, db, "事务");
    c.edge(app, cache, "缓存");
  } else if (kind === "microservices") {
    for (const [i, name] of ["身份服务", "订单服务", "库存服务"].entries()) {
      const app = c.node(
        "architecture.service",
        name,
        710,
        100 + i * 200,
        boundary,
      );
      const db = c.node(
        "architecture.database",
        name.replace("服务", "数据库"),
        1080,
        100 + i * 200,
        boundary,
      );
      app.structure.icon_id = "server";
      c.edge(gateway, app, "路由");
      c.edge(app, db, "独立存储");
    }
  } else if (kind === "events") {
    const producer = c.node(
      "architecture.service",
      "订单服务",
      690,
      260,
      boundary,
    );
    const broker = c.node("architecture.queue", "事件总线", 980, 260, boundary);
    const notify = c.node(
      "architecture.service",
      "通知消费者",
      1080,
      70,
      boundary,
    );
    const billing = c.node(
      "architecture.service",
      "账单消费者",
      1080,
      500,
      boundary,
    );
    c.edge(gateway, producer);
    c.edge(producer, broker, "订单已创建");
    c.edge(broker, notify, "订阅");
    c.edge(broker, billing, "订阅");
  } else {
    const first = c.node(
      "architecture.service",
      "实例 A / Zone A",
      710,
      130,
      boundary,
    );
    const second = c.node(
      "architecture.service",
      "实例 B / Zone B",
      710,
      400,
      boundary,
    );
    const db = c.node("architecture.database", "主数据库", 1080, 130, boundary);
    const replica = c.node(
      "architecture.database",
      "只读副本",
      1080,
      400,
      boundary,
    );
    c.edge(gateway, first, "健康检查");
    c.edge(gateway, second, "健康检查");
    c.edge(first, db, "读写");
    c.edge(second, db, "读写");
    c.edge(db, replica, "复制", "bottom", "top");
  }
  return c.elements;
}
type EntitySpec = { name: string; fields: Array<[string, string, string?]> };
function er(page: string, kind: string) {
  const c = context(page);
  const pk: [string, string, string] = ["id", "UUID", "primary"];
  const definitions: Record<
    string,
    { entities: EntitySpec[]; links: Array<[number, number, string]> }
  > = {
    users: {
      entities: [
        {
          name: "用户",
          fields: [
            pk,
            ["email", "VARCHAR(254)"],
            ["display_name", "VARCHAR(120)"],
          ],
        },
        { name: "角色", fields: [pk, ["name", "VARCHAR(80)"]] },
        { name: "权限", fields: [pk, ["code", "VARCHAR(120)"]] },
        {
          name: "用户角色",
          fields: [
            pk,
            ["user_id", "UUID", "foreign"],
            ["role_id", "UUID", "foreign"],
          ],
        },
        {
          name: "角色权限",
          fields: [
            pk,
            ["role_id", "UUID", "foreign"],
            ["permission_id", "UUID", "foreign"],
          ],
        },
      ],
      links: [
        [0, 3, "user_id"],
        [1, 3, "role_id"],
        [1, 4, "role_id"],
        [2, 4, "permission_id"],
      ],
    },
    orders: {
      entities: [
        { name: "用户", fields: [pk, ["email", "VARCHAR(254)"]] },
        {
          name: "订单",
          fields: [
            pk,
            ["user_id", "UUID", "foreign"],
            ["status", "VARCHAR(20)"],
            ["created_at_ms", "BIGINT"],
          ],
        },
        {
          name: "商品",
          fields: [pk, ["name", "VARCHAR(120)"], ["price", "DECIMAL(12,2)"]],
        },
        {
          name: "订单明细",
          fields: [
            pk,
            ["order_id", "UUID", "foreign"],
            ["product_id", "UUID", "foreign"],
            ["quantity", "INTEGER"],
          ],
        },
      ],
      links: [
        [0, 1, "user_id"],
        [1, 3, "order_id"],
        [2, 3, "product_id"],
      ],
    },
    content: {
      entities: [
        { name: "作者", fields: [pk, ["name", "VARCHAR(120)"]] },
        {
          name: "文档",
          fields: [
            pk,
            ["author_id", "UUID", "foreign"],
            ["title", "VARCHAR(240)"],
          ],
        },
        { name: "标签", fields: [pk, ["name", "VARCHAR(80)"]] },
        {
          name: "文档标签",
          fields: [
            pk,
            ["document_id", "UUID", "foreign"],
            ["tag_id", "UUID", "foreign"],
          ],
        },
      ],
      links: [
        [0, 1, "author_id"],
        [1, 3, "document_id"],
        [2, 3, "tag_id"],
      ],
    },
    tasks: {
      entities: [
        { name: "项目", fields: [pk, ["name", "VARCHAR(120)"]] },
        {
          name: "任务",
          fields: [
            pk,
            ["project_id", "UUID", "foreign"],
            ["title", "VARCHAR(240)"],
            ["status", "VARCHAR(20)"],
          ],
        },
        { name: "成员", fields: [pk, ["name", "VARCHAR(120)"]] },
        {
          name: "任务分配",
          fields: [
            pk,
            ["task_id", "UUID", "foreign"],
            ["member_id", "UUID", "foreign"],
          ],
        },
      ],
      links: [
        [0, 1, "project_id"],
        [1, 3, "task_id"],
        [2, 3, "member_id"],
      ],
    },
  };
  const spec = definitions[kind];
  const nodes = spec.entities.map((entity, i) => {
    const node = c.node(
      "er.entity",
      entity.name,
      80 + (i % 3) * 400,
      80 + Math.floor(i / 3) * 320,
    );
    node.geometry.width = 280;
    node.geometry.height = 64 + entity.fields.length * 24;
    node.structure.members = members(entity.fields);
    return node;
  });
  for (const [from, to, key] of spec.links) {
    const source = nodes[from],
      target = nodes[to];
    const edge = c.edge(
      source,
      target,
      "",
      "right:" + source.structure.members[0].id,
      "left:" + target.structure.members.find((m) => m.name === key)!.id,
    );
    edge.structure.start_marker = "one";
    edge.structure.end_marker = "many";
  }
  return c.elements;
}
function lanes(page: string, title: string, labels: string[]) {
  const c = context(page),
    pool = c.node("swimlane.pool", title, 60, 60);
  pool.geometry.width = 1100;
  pool.geometry.height = labels.length * 170 + 70;
  let previous: Element | undefined;
  labels.forEach((label, i) => {
    const lane = c.node("swimlane.horizontal", label, 110, 110 + i * 170, pool);
    lane.geometry.width = 1000;
    lane.geometry.height = 160;
    const task = c.node(
      "swimlane.task",
      ["提交申请", "核验信息", "确认与执行", "归档记录"][i % 4],
      190 + i * 210,
      150 + i * 170,
      lane,
    );
    if (previous) c.edge(previous, task, "转交", "bottom", "top");
    previous = task;
  });
  return c.elements;
}
function uml(page: string, kind: string) {
  const c = context(page);
  if (kind === "class") {
    const a = c.node("uml.interface", "«interface»\nRepository", 360, 60);
    a.geometry.width = 280;
    a.structure.members = members([
      ["+ find(id)", "Entity"],
      ["+ save(entity)", "void"],
    ]);
    const b = c.node("uml.class", "PostgresRepository", 100, 330);
    b.geometry.width = 280;
    b.structure.members = members([
      ["- connection", "Database"],
      ["+ find(id)", "Entity"],
      ["+ save(entity)", "void"],
    ]);
    const d = c.node("uml.class", "ApplicationService", 600, 330);
    d.geometry.width = 280;
    d.structure.members = members([
      ["- repository", "Repository"],
      ["+ execute()", "Result"],
    ]);
    const inheritance = c.edge(b, a, "实现", "top", "bottom");
    inheritance.structure.end_marker = "triangle";
    inheritance.style.dashed = true;
    c.edge(d, a, "依赖", "top", "right");
  } else if (kind === "usecase") {
    const frame = c.node("uml.system", "订单系统", 300, 70);
    frame.geometry.width = 500;
    frame.geometry.height = 500;
    const actor = c.node("uml.actor", "用户", 80, 230),
      admin = c.node("uml.actor", "管理员", 930, 230);
    for (const [i, label] of ["创建订单", "查看订单", "处理退款"].entries()) {
      const node = c.node("uml.usecase", label, 460, 130 + i * 140, frame);
      const edge = c.edge(i === 2 ? admin : actor, node);
      edge.structure.end_marker = "none";
    }
  } else if (kind === "state") {
    const nodes = ["初始", "待处理", "处理中", "完成"].map((name, i) =>
      c.node(
        i === 0 ? "uml.initial" : i === 3 ? "uml.final" : "uml.state",
        i === 0 || i === 3 ? "" : name,
        100 + i * 260,
        200,
      ),
    );
    nodes[0].geometry.width = 40;
    nodes[0].geometry.height = 40;
    nodes[3].geometry.width = 40;
    nodes[3].geometry.height = 40;
    nodes.forEach((n, i) => {
      if (i) c.edge(nodes[i - 1], n, ["", "创建", "确认", "成功"][i]);
    });
    const failure = c.node("uml.state", "处理失败", 620, 440);
    c.edge(nodes[2], failure, "失败", "bottom", "top");
    c.edge(failure, nodes[1], "重试", "left", "bottom");
  } else {
    const nodes = ["客户端", "API 服务", "数据库"].map((name, i) =>
      c.node("uml.lifeline", name, 100 + i * 330, 80),
    );
    nodes.forEach((n) => {
      n.geometry.width = 190;
      n.geometry.height = 520;
    });
    const messages: [
      [number, number, string, number],
      [number, number, string, number],
      [number, number, string, number],
      [number, number, string, number],
    ] = [
      [0, 1, "提交请求", 0.3],
      [1, 2, "查询数据", 0.48],
      [2, 1, "返回结果", 0.65],
      [1, 0, "响应", 0.82],
    ];
    for (const [a, b, label, time] of messages) {
      const edge = c.edge(
        nodes[a],
        nodes[b],
        label,
        "time:" + time,
        "time:" + time,
      );
      edge.structure.route = "straight";
      edge.style.dashed = a > b;
    }
  }
  return c.elements;
}
export const TEMPLATES: Template[] = [
  ...[
    [
      "approval",
      "审批流程",
      ["提交申请", "资料核验", "是否通过", "审批执行", "完成"],
    ],
    [
      "order",
      "订单履约",
      ["创建订单", "确认支付", "库存充足", "发货交付", "完成"],
    ],
    [
      "exception",
      "异常处理",
      ["发现异常", "收集上下文", "可以重试", "执行恢复", "关闭事件"],
    ],
    [
      "signup",
      "用户注册",
      ["提交注册", "验证邮箱", "信息有效", "创建账号", "进入工作空间"],
    ],
  ].map(([id, name, labels]) => ({
    id: "flow." + id,
    category: "flow",
    name: name as string,
    description: "含条件分支、回路与连接标签",
    build: (page: string) => flow(page, labels as string[]),
  })),
  ...[
    ["project", "项目规划", ["范围", "里程碑", "资源", "风险"]],
    [
      "knowledge",
      "知识整理",
      ["核心概念", "实践经验", "参考资料", "待解决问题"],
    ],
    ["meeting", "会议整理", ["议题", "结论", "行动项", "后续安排"]],
    ["problem", "问题分析", ["现象", "可能原因", "验证方法", "解决方案"]],
  ].map(([id, name, labels]) => ({
    id: "mindmap." + id,
    category: "mindmap",
    name: name as string,
    description: "可调整层级的主题与分支",
    build: (page: string) => mindmap(page, name as string, labels as string[]),
  })),
  ...[
    ["three-tier", "三层应用"],
    ["microservices", "微服务"],
    ["events", "事件驱动"],
    ["deployment", "部署拓扑"],
  ].map(([id, name]) => ({
    id: "architecture." + id,
    category: "architecture",
    name,
    description: "系统边界、服务、存储与通信关系",
    build: (page: string) => architecture(page, name, id),
  })),
  ...[
    ["class", "类图"],
    ["usecase", "用例图"],
    ["state", "状态图"],
    ["sequence", "时序图"],
  ].map(([id, name]) => ({
    id: "uml." + id,
    category: "uml",
    name,
    description: "具有对应结构与关系的 UML 图",
    build: (page: string) => uml(page, id),
  })),
  ...[
    ["users", "用户权限", ["用户", "角色", "权限", "用户角色"]],
    ["orders", "订单商品", ["用户", "订单", "商品", "订单明细"]],
    ["content", "内容管理", ["作者", "文档", "标签", "文档标签"]],
    ["tasks", "项目任务", ["项目", "任务", "成员", "任务分配"]],
  ].map(([id, name, labels]) => ({
    id: "er." + id,
    category: "er",
    name: name as string,
    description: "主外键、字段端口与一对多关系",
    build: (page: string) => er(page, id as string),
  })),
  ...[
    ["approval", "跨部门审批", ["申请人", "业务负责人", "财务"]],
    ["purchase", "采购协作", ["需求方", "采购", "供应商", "财务"]],
    ["support", "客户服务", ["客户", "客服", "技术支持"]],
    ["release", "产品发布", ["产品", "研发", "测试", "运维"]],
  ].map(([id, name, labels]) => ({
    id: "swimlane." + id,
    category: "swimlane",
    name: name as string,
    description: "泳道归属、跨角色任务与交接",
    build: (page: string) => lanes(page, name as string, labels as string[]),
  })),
];
export function cloneElements(
  elements: Element[],
  page: string,
  dx = 40,
  dy = 40,
  scene = new Map(elements.map((e) => [e.id, e])),
): Element[] {
  const ids = new Map<string, string>();
  for (const e of elements) {
    ids.set(e.id, crypto.randomUUID());
    for (const member of e.structure.members)
      ids.set(member.id, crypto.randomUUID());
  }
  return elements.map((original) => {
    const e = structuredClone(original);
    e.id = ids.get(original.id)!;
    e.page_id = page;
    e.version = 0;
    e.versions = { geometry: 0, style: 0, text: 0, structure: 0 };
    e.geometry.x += dx;
    e.geometry.y += dy;
    e.structure.parent_id = e.structure.parent_id
      ? (ids.get(e.structure.parent_id) ?? null)
      : null;
    for (const member of e.structure.members) member.id = ids.get(member.id)!;
    for (const endpoint of [e.structure.start, e.structure.end])
      if (endpoint) {
        if (endpoint.element_id) {
          if (!ids.has(endpoint.element_id)) {
            const target = scene.get(endpoint.element_id);
            if (target)
              Object.assign(endpoint, portPosition(target, endpoint.port));
          }
          endpoint.element_id = ids.get(endpoint.element_id) ?? null;
        }
        const parts = endpoint.port.split(":");
        if (parts.length === 2 && ids.has(parts[1]))
          endpoint.port = parts[0] + ":" + ids.get(parts[1]);
        endpoint.x += dx;
        endpoint.y += dy;
      }
    if (e.shape_type === "connector")
      e.structure.points = e.structure.points.map((p) => ({
        x: p.x + dx,
        y: p.y + dy,
      }));
    return e;
  });
}
