import { hiddenElements } from "./mindmap";
import { SHAPES, type Element } from "./model";
import {
  CANVAS_FONT,
  MEMBER_HEADER_HEIGHT,
  MEMBER_ROW_HEIGHT,
  connectorPath,
  connectorPoints,
  elementBounds,
  isContainer,
  isMemberShape,
  shapePath,
  unionBounds,
  wrapText,
} from "./geometry";
import { iconData } from "./icons";
const MAX_EXPORT_PIXELS = 16_000_000;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
export async function exportSVG(
  elements: Element[],
  background = "#ffffff",
  assetURL?: (id: string) => Promise<string>,
): Promise<string> {
  const scene = new Map(elements.map((e) => [e.id, e])),
    bounds = unionBounds(elements.map((e) => elementBounds(e, scene)));
  const canvas = document.createElement("canvas"),
    measure = canvas.getContext("2d")!;
  const parts: string[] = [];
  const hidden = hiddenElements(scene);
  const sorted = [...elements]
    .filter((e) => !hidden.has(e.id))
    .sort(
      (a, b) =>
        Number(isContainer(b)) - Number(isContainer(a)) ||
        a.structure.order - b.structure.order ||
        a.id.localeCompare(b.id),
    );
  for (const e of sorted) {
    const g = e.geometry,
      s = e.style,
      primitive = SHAPES.get(e.shape_type)?.primitive ?? "rect";
    const stroke = `stroke="${escape(s.stroke)}" stroke-width="${s.stroke_width}" ${s.dashed ? 'stroke-dasharray="6 4"' : ""}`;
    if (e.shape_type === "connector") {
      parts.push(
        `<path d="${connectorPath(e, scene)}" fill="none" ${stroke}/>`,
      );
      const points = connectorPoints(e, scene);
      for (const [kind, tip, previous] of [
        [e.structure.start_marker, points[0], points[1]],
        [e.structure.end_marker, points.at(-1)!, points.at(-2)!],
      ] as const) {
        if (kind === "none") continue;
        const angle =
          (Math.atan2(tip.y - previous.y, tip.x - previous.x) * 180) / Math.PI;
        const path =
          kind === "diamond"
            ? "M0 0L-9 -5L-18 0L-9 5Z"
            : kind === "one"
              ? "M-8 -7V7"
              : kind === "many"
                ? "M0 -8L-12 0L0 8M-12 0H0"
                : "M0 0L-11 -5V5Z";
        parts.push(
          `<g transform="translate(${tip.x} ${tip.y}) rotate(${angle})">${kind === "circle" ? '<circle cx="-5" r="5"' : `<path d="${path}"`} fill="${kind === "triangle" ? escape(s.fill) : kind === "many" || kind === "one" ? "none" : escape(s.stroke)}" ${stroke}/></g>`,
        );
      }
      if (e.text) {
        const p = points[Math.floor(points.length / 2)];
        parts.push(
          `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="${s.font_size}" fill="${escape(s.text_color)}">${escape(e.text)}</text>`,
        );
      }
      continue;
    }
    parts.push(
      `<g opacity="${s.opacity}" transform="translate(${g.x + g.width / 2} ${g.y + g.height / 2}) rotate(${(g.rotation_rad * 180) / Math.PI}) translate(${-g.width / 2} ${-g.height / 2})">`,
    );
    const path =
      primitive === "line" && e.structure.points.length
        ? e.structure.points
            .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
            .join(" ")
        : shapePath(primitive);
    if (path)
      parts.push(
        `<path d="${path}" transform="scale(${g.width / 100} ${g.height / 100})" fill="${["actor", "annotation", "line", "search"].includes(primitive) ? "none" : escape(primitive === "initial" || primitive === "fork" ? s.stroke : s.fill)}" ${stroke} vector-effect="non-scaling-stroke"/>`,
      );
    if (e.structure.asset_id) {
      if (!assetURL) throw new Error("图片资源未准备完成。");
      parts.push(
        `<image href="${escape(await assetURL(e.structure.asset_id))}" width="${g.width}" height="${g.height}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    }
    if (isMemberShape(e)) {
      parts.push(
        `<path d="M0 ${MEMBER_HEADER_HEIGHT}H${g.width}" fill="none" ${stroke}/>`,
      );
      e.structure.members.forEach((member, i) =>
        parts.push(
          `<text x="12" y="${MEMBER_HEADER_HEIGHT + (i + 0.75) * MEMBER_ROW_HEIGHT}" font-size="${s.font_size}" fill="${escape(s.text_color)}">${escape((member.key === "primary" ? "PK " : member.key === "foreign" ? "FK " : "") + member.name + (member.type ? " : " + member.type : ""))}</text>`,
        ),
      );
    }
    if (e.structure.icon_id) {
      const icon = await iconData(e.structure.icon_id);
      const size = Math.min(36, g.height - 16, g.width - 16);
      parts.push(
        `<svg x="10" y="10" width="${size}" height="${size}" viewBox="0 0 ${icon.width} ${icon.height}" color="${escape(s.text_color)}">${icon.body}</svg>`,
      );
    }
    measure.font = `${s.bold ? "bold " : ""}${s.font_size}px ${CANVAS_FONT}`;
    const top = isContainer(e) || isMemberShape(e) || primitive === "lifeline",
      lines = wrapText(
        e.text,
        Math.max(1, g.width - 20),
        (text) => measure.measureText(text).width,
      );
    const x =
        top || s.align === "left"
          ? 10
          : s.align === "right"
            ? g.width - 10
            : g.width / 2,
      anchor =
        top || s.align === "left"
          ? "start"
          : s.align === "right"
            ? "end"
            : "middle";
    const initialY = top
      ? 22
      : Math.max(
          s.font_size,
          (g.height - lines.length * s.font_size * 1.2) / 2 + s.font_size,
        );
    parts.push(
      `<text x="${x}" y="${initialY}" text-anchor="${anchor}" font-size="${s.font_size}" font-weight="${s.bold || top ? 600 : 400}" fill="${escape(s.text_color)}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? s.font_size * 1.2 : 0}">${escape(line)}</tspan>`).join("")}</text></g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width + 80}" height="${bounds.height + 80}" viewBox="${bounds.x - 40} ${bounds.y - 40} ${bounds.width + 80} ${bounds.height + 80}" font-family="${escape(CANVAS_FONT)}"><rect x="${bounds.x - 40}" y="${bounds.y - 40}" width="${bounds.width + 80}" height="${bounds.height + 80}" fill="${escape(background)}"/>${parts.join("")}</svg>`;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportPNG(svg: string): Promise<Blob> {
  const image = new Image(),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("画板图片导出失败。"));
      image.src = url;
    });
    const factor = Math.min(
      2,
      Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, image.width * image.height)),
      8192 / Math.max(image.width, image.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(image.width * factor));
    canvas.height = Math.max(1, Math.ceil(image.height * factor));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("画板图片导出失败。")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
