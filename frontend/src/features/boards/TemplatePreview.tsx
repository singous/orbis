import { useMemo } from "react";
import {
  connectorPath,
  elementBounds,
  shapePath,
  unionBounds,
} from "./geometry";
import { SHAPES } from "./model";
import type { Template } from "./templates";

/** A lightweight vector thumbnail; template browsing never mounts a canvas editor. */
export function TemplatePreview({ template }: { template: Template }) {
  const scene = useMemo(() => {
    const elements = template.build("00000000-0000-4000-8000-000000000001");
    return new Map(elements.map((e) => [e.id, e]));
  }, [template]);
  const bounds = unionBounds(
    [...scene.values()].map((e) => elementBounds(e, scene)),
  );
  return (
    <svg
      viewBox={[
        bounds.x - 30,
        bounds.y - 30,
        bounds.width + 60,
        bounds.height + 60,
      ].join(" ")}
      aria-hidden="true"
      className="board-template-preview"
    >
      {[...scene.values()].map((e) =>
        e.shape_type === "connector" ? (
          <path
            key={e.id}
            d={connectorPath(e, scene)}
            fill="none"
            stroke={e.style.stroke}
            strokeWidth="4"
          />
        ) : (
          <g
            key={e.id}
            transform={`translate(${e.geometry.x} ${e.geometry.y})`}
          >
            <path
              d={shapePath(SHAPES.get(e.shape_type)?.primitive ?? "rect")}
              transform={`scale(${e.geometry.width / 100} ${e.geometry.height / 100})`}
              fill={e.style.fill}
              stroke={e.style.stroke}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={e.geometry.width / 2}
              y={e.geometry.height / 2}
              fill={e.style.text_color}
              fontSize="15"
              textAnchor="middle"
            >
              {e.text.slice(0, 14)}
            </text>
          </g>
        ),
      )}
    </svg>
  );
}
