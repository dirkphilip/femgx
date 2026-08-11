import type { ElementModel } from "../../src/elements/model";
import { heterogeneousElementParts } from "../../src/geometry/heterogeneous-element-mesh";
import type { Bounds, Part } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { createScene, type Scene } from "../../src/scene/scene";
import type { PartId } from "../../src/geometry/part";
import type { AssemblyId } from "../../src/scene/types";
import type { ElementDisplayMode } from "./types";
import { buildHeterogeneousModel } from "./element-models";

/** The one-model, three-primitive-group heterogeneous demo fixture. */
export interface HeterogeneousFixture {
  readonly scene: Scene;
  readonly partIds: {
    readonly triangle: PartId;
    readonly line: PartId;
    readonly point: PartId;
  };
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly modePartIds: ReadonlyMap<ElementDisplayMode, readonly PartId[]>;
  readonly overlayPartIds: readonly PartId[];
  readonly defaultMode: ElementDisplayMode;
  readonly instanceCount: number;
  readonly bounds: Bounds;
}

const TRIANGLE_PART_ID: PartId = 30;
const LINE_PART_ID: PartId = 31;
const POINT_PART_ID: PartId = 32;
const ROOT_ASSEMBLY_ID: AssemblyId = 4;

/** Builds the recommended heterogeneous ElementModel workflow. */
export function createHeterogeneousFixture(): HeterogeneousFixture {
  const model = buildHeterogeneousModel();
  const parts = heterogeneousElementParts(
    { triangle: TRIANGLE_PART_ID, line: LINE_PART_ID, point: POINT_PART_ID },
    model,
  );
  const triangle = requirePart(parts.triangle, "triangle");
  const line = requirePart(parts.line, "line");
  const point = requirePart(parts.point, "point");
  const sourceParts = [triangle, line, point] as const;
  const scene = createHeterogeneousScene(sourceParts);
  const elementModels = new Map<PartId, ElementModel>([
    [TRIANGLE_PART_ID, model],
    [LINE_PART_ID, model],
    [POINT_PART_ID, model],
  ]);
  return {
    scene,
    partIds: { triangle: TRIANGLE_PART_ID, line: LINE_PART_ID, point: POINT_PART_ID },
    elementModels,
    modePartIds: new Map<ElementDisplayMode, readonly PartId[]>([
      ["solid", [TRIANGLE_PART_ID]],
      ["surface", [TRIANGLE_PART_ID]],
      ["edges", [TRIANGLE_PART_ID]],
    ]),
    overlayPartIds: [LINE_PART_ID, POINT_PART_ID],
    defaultMode: "solid",
    instanceCount: sourceParts.length,
    bounds: mergePartBounds(sourceParts),
  };
}

function requirePart(part: Part | undefined, group: string): Part {
  if (part === undefined) throw new Error(`Heterogeneous fixture has no ${group} part`);
  return part;
}

function createHeterogeneousScene(parts: readonly Part[]): Scene {
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  return builder
    .addAssembly({
      id: ROOT_ASSEMBLY_ID,
      name: "heterogeneous-model",
      placements: parts.map((part) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identity(),
      })),
    })
    .withRoot(ROOT_ASSEMBLY_ID)
    .build();
}

function mergePartBounds(parts: readonly Part[]): Bounds {
  const first = parts[0]?.bounds;
  if (first === undefined) throw new Error("Heterogeneous fixture requires one part");
  return parts.slice(1).reduce((bounds, part) => mergeBounds(bounds, part.bounds), first);
}

function mergeBounds(first: Bounds, second: Bounds): Bounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    minZ: Math.min(first.minZ, second.minZ),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    maxZ: Math.max(first.maxZ, second.maxZ),
  };
}
