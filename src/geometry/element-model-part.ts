import type { FaceIdRef } from "../elements/faces";
import type { ElementModel } from "../elements/model";
import { elementModelTopologyAt } from "../elements/model-topology";
import { createPartFromGraphColumns, type Part } from "./part";
import {
  buildPartSemanticGraphFromFragments,
  type ElementSemanticFragment,
} from "./semantic/part-semantic-graph-builder";
import type { LineGeometryInput, PointGeometryInput, TriangleGeometryInput } from "./types";
import type { PartId } from "./part";
import type { DirectEdgeSources } from "./semantic/direct-edge-columns";
import type { DirectFaceSources } from "./semantic/direct-face-columns";
import { mergeSurfaceEdgeSources } from "./semantic/surface-edge-fragments";
import { lineGeometry, pointGeometry, volumeGeometry } from "./element-mesh-builders";

/**
 * Tessellation options shared by the single mixed-model compiler.
 * @category Scene and geometry
 */
export interface CreatePartFromElementModelOptions {
  /** Optional stable element-face identities to draw in the triangle group. */
  readonly faceSubset?: readonly FaceIdRef[];
}

interface ElementGroups {
  readonly triangle: Uint32Array;
  readonly line: Uint32Array;
  readonly point: Uint32Array;
}

/**
 * Builds one semantic part from a heterogeneous element model.
 *
 * Geometry remains homogeneous inside each renderer leaf, while one shared
 * element table retains authored ids, shapes, bodies, and node-pick
 * mappings at part level. This is the bridge between FE authoring and the
 * canonical {@link root.Scene} workflow: compile once, then place the resulting
 * definition through assemblies without copying geometry per occurrence.
 *
 * The compiler supports the product's linear and quadratic element families;
 * quadratic elements are tessellated into deterministic straight primitives.
 * `faceSubset` can restrict the emitted solid faces while preserving their
 * authored face identities.
 * @example Compile a model and place its reusable part.
 * ```ts
 * import { createSceneBuilder, identityMatrix } from "femgx";
 * import { createPartFromElementModel } from "femgx/model";
 *
 * const part = createPartFromElementModel(10, model);
 * const scene = createSceneBuilder()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 20,
 *     name: "root",
 *     placements: [{ kind: "part", partId: part.id, transform: identityMatrix() }],
 *   })
 *   .setRootAssembly(20)
 *   .build();
 * ```
 * @category Scene and geometry
 */
export function createPartFromElementModel(
  partId: PartId,
  model: ElementModel,
  options: CreatePartFromElementModelOptions = {},
): Part {
  const groups = classifyElements(model);
  const builds: {
    readonly geometry: TriangleGeometryInput | LineGeometryInput | PointGeometryInput;
    readonly fragment: ElementSemanticFragment;
    readonly edgeSources?: DirectEdgeSources;
    readonly faceSources?: DirectFaceSources;
    readonly faceSubsetOrdinals?: Uint32Array;
  }[] = [];
  if (groups.triangle.length > 0) {
    builds.push(
      volumeGeometry({
        model,
        ordinals: groups.triangle,
        faceSubset: options.faceSubset,
      }),
    );
  }
  if (groups.line.length > 0) {
    builds.push(lineGeometry(model, groups.line));
  }
  if (groups.point.length > 0) {
    builds.push(pointGeometry(model, groups.point));
  }
  const geometries = builds.map(({ geometry }) => geometry);
  const edgeSources = mergeSurfaceEdgeSources(builds);
  const faceSources = builds.find((build) => build.faceSources !== undefined)?.faceSources;
  const faceSubset = directFaceSubset(builds);
  const graph = buildPartSemanticGraphFromFragments(
    geometries,
    model,
    builds.map((build) => build.fragment),
    {
      ...(edgeSources === undefined ? {} : { edgeSources }),
      ...(faceSources === undefined ? {} : { faceSources }),
      ...(faceSubset === undefined ? {} : { faceSubset }),
    },
  );
  return createPartFromGraphColumns(partId, {
    geometries,
    graph,
    nodePositions: new Float32Array(model.nodes),
  });
}

function directFaceSubset(
  builds: readonly { readonly faceSubsetOrdinals?: Uint32Array }[],
):
  | { readonly offsets: Uint32Array; readonly ordinals: Uint32Array; readonly defined: Uint8Array }
  | undefined {
  let geometry = -1;
  let ordinals: Uint32Array | undefined;
  for (let index = 0; index < builds.length; index += 1) {
    const subset = builds[index]?.faceSubsetOrdinals;
    if (subset !== undefined) {
      geometry = index;
      ordinals = subset;
      break;
    }
  }
  if (geometry < 0 || ordinals === undefined) return undefined;
  const offsets = new Uint32Array(builds.length + 1);
  offsets[geometry + 1] = ordinals.length;
  for (let index = geometry + 2; index < offsets.length; index += 1) {
    offsets[index] = ordinals.length;
  }
  const defined = new Uint8Array(builds.length);
  defined[geometry] = 1;
  return { offsets, ordinals, defined };
}

function classifyElements(model: ElementModel): ElementGroups {
  let triangles = 0;
  let lines = 0;
  let points = 0;
  for (let ordinal = 0; ordinal < model.elementIds.length; ordinal += 1) {
    const group = elementGroup(model, ordinal);
    if (group === "triangle") triangles += 1;
    else if (group === "line") lines += 1;
    else points += 1;
  }
  const triangle = new Uint32Array(triangles);
  const line = new Uint32Array(lines);
  const point = new Uint32Array(points);
  let triangleIndex = 0;
  let lineIndex = 0;
  let pointIndex = 0;
  for (let ordinal = 0; ordinal < model.elementIds.length; ordinal += 1) {
    const group = elementGroup(model, ordinal);
    if (group === "triangle") triangle[triangleIndex++] = ordinal;
    else if (group === "line") line[lineIndex++] = ordinal;
    else point[pointIndex++] = ordinal;
  }
  return { triangle, line, point };
}

function elementGroup(model: ElementModel, ordinal: number): "triangle" | "line" | "point" {
  switch (elementModelTopologyAt(model, ordinal).family) {
    case "point":
      return "point";
    case "line":
      return "line";
    case "triangle":
    case "quad":
    case "tet":
    case "wedge":
    case "pyramid":
    case "hex":
      return "triangle";
  }
}
