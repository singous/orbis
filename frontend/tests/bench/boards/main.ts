import { BoardRenderer } from "../../../src/features/boards/renderer";
import { makeElement, type Element } from "../../../src/features/boards/model";
import {
  elementBounds,
  unionBounds,
} from "../../../src/features/boards/geometry";
const noop = () => {};
const renderer = new BoardRenderer(
  document.querySelector<HTMLDivElement>("#canvas")!,
  {
    down: noop,
    move: noop,
    up: noop,
    doubleClick: noop,
    zoom: (camera) => renderer.setCamera(camera),
  },
);
let scene = new Map<string, Element>();
const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
function fixture(count: number) {
  const page = crypto.randomUUID(),
    elements = new Map<string, Element>(),
    nodes: Element[] = [];
  const nodeCount = Math.ceil(count * 0.6);
  for (let i = 0; i < nodeCount; i++) {
    const element = makeElement(
      ["flow.process", "er.entity", "architecture.service", "uml.class"][i % 4],
      page,
      (i % 40) * 240,
      Math.floor(i / 40) * 200,
    );
    element.text = "订单服务 " + i + "\n中文 English 混合文本";
    if (i % 4 === 1)
      element.structure.members = [
        {
          id: crypto.randomUUID(),
          name: "订单编号",
          type: "UUID",
          key: "primary",
        },
      ];
    if (i % 7 === 0) element.structure.icon_id = "server";
    elements.set(element.id, element);
    nodes.push(element);
  }
  for (let i = nodeCount; i < count; i++) {
    const edge = makeElement("connector", page, 0, 0),
      a = nodes[(i - nodeCount) % nodes.length],
      b = nodes[(i - nodeCount + 1) % nodes.length];
    edge.structure.start = { element_id: a.id, port: "right", x: 0, y: 0 };
    edge.structure.end = { element_id: b.id, port: "left", x: 0, y: 0 };
    edge.text = "调用";
    elements.set(edge.id, edge);
  }
  return elements;
}
const benchmark = {
  async load(count: number) {
    const start = performance.now();
    scene = fixture(count);
    renderer.setElements(scene);
    renderer.setCamera({ x: 60, y: 60, zoom: 1 });
    await nextFrame();
    await nextFrame();
    document.querySelector("#status")!.textContent = count + " elements";
    return { load_ms: performance.now() - start, ...renderer.stats() };
  },
  async pan(frames = 90, overview = false) {
    const camera = overview
      ? renderer.fit(
          unionBounds(
            [...scene.values()].map((element) => elementBounds(element, scene)),
          ),
        )
      : { x: 60, y: 60, zoom: 1 };
    const bounds = unionBounds(
      [...scene.values()].map((e) => elementBounds(e, scene)),
    );
    const fitsAll =
      camera.x + bounds.x * camera.zoom >= 0 &&
      camera.y + bounds.y * camera.zoom >= 0 &&
      camera.x + (bounds.x + bounds.width) * camera.zoom <=
        renderer.stage.width() &&
      camera.y + (bounds.y + bounds.height) * camera.zoom <=
        renderer.stage.height();
    if (overview && !fitsAll) throw new Error("Fit omitted part of the scene");
    renderer.setCamera(camera);
    for (let i = 0; i < 10; i++) await nextFrame();
    const durations = [];
    let last = await nextFrame();
    for (let i = 0; i < frames; i++) {
      renderer.setCamera({
        ...camera,
        x: camera.x - i * 4,
        y: camera.y - i * 2,
      });
      const now = await nextFrame();
      durations.push(now - last);
      last = now;
    }
    durations.sort((a, b) => a - b);
    return {
      p95_ms: durations[Math.floor(durations.length * 0.95)],
      ...renderer.stats(),
    };
  },
  async drag(frames = 90) {
    renderer.setCamera({ x: 60, y: 60, zoom: 1 });
    const element = [...scene.values()].find(
      (e) => e.shape_type !== "connector",
    )!;
    const durations = [];
    let last = await nextFrame();
    for (let i = 0; i < frames; i++) {
      renderer.setPreview([
        {
          ...element,
          geometry: {
            ...element.geometry,
            x: element.geometry.x + i,
            y: element.geometry.y + i / 2,
          },
        },
      ]);
      const now = await nextFrame();
      durations.push(now - last);
      last = now;
    }
    renderer.clearPreview();
    durations.sort((a, b) => a - b);
    return {
      p95_ms: durations[Math.floor(durations.length * 0.95)],
      ...renderer.stats(),
    };
  },
};
Object.assign(window, { boardBenchmark: benchmark });
