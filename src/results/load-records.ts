import type { Part } from "../geometry/part";
import { finiteOrZero } from "../math/scalar";
import type { NodalLoadField } from "./fields";
import type { ElementalOrientationRecords } from "./orientation-records";

const ZERO_TOLERANCE = 1e-12;
const MOMENT_SEGMENTS = 6;
type Vec3 = [number, number, number];

interface LoadRecord {
  readonly node: number;
  readonly anchor: Vec3;
  readonly direction: Vec3;
  readonly length: number;
  readonly mode: number;
}

interface FiniteVector {
  readonly unit: Vec3;
  readonly length: number;
}

interface AppendOptions {
  readonly records: LoadRecord[];
  readonly node: number;
  readonly anchor: Vec3;
  readonly values: Float32Array;
  readonly base: number;
  readonly scale: number;
}

/** Resolves authored nodal forces and moments into the existing glyph path. */
export function resolveNodalLoadRecords(
  part: Part,
  field: NodalLoadField,
  displacements?: Float32Array,
  forceLengthScale = 1,
  momentLengthScale = 1,
): ElementalOrientationRecords {
  if (part.id !== field.partId) return emptyRecords();
  const positions = part.nodePositions;
  const nodeCount = positions === undefined ? 0 : positions.length / 3;
  const records: LoadRecord[] = [];
  for (let node = 0; node < Math.min(nodeCount, field.count); node += 1) {
    const anchor = nodePosition(positions, node);
    appendForce({
      records,
      node,
      anchor,
      values: field.values,
      base: node * 6,
      scale: forceLengthScale,
    });
    appendMoment({
      records,
      node,
      anchor,
      values: field.values,
      base: node * 6 + 3,
      scale: momentLengthScale,
    });
  }
  return packLoadRecords(part, records, displacements);
}

function emptyRecords(): ElementalOrientationRecords {
  return {
    elementIds: new Uint32Array(),
    bodyIds: new Uint32Array(),
    anchors: new Float32Array(),
    referenceLengths: new Float32Array(),
    directions: new Float32Array(),
    glyphModes: new Uint32Array(),
    anchorDeltas: undefined,
  };
}

function nodePosition(positions: Float32Array | undefined, node: number): Vec3 {
  const base = node * 3;
  return [positions?.[base] ?? 0, positions?.[base + 1] ?? 0, positions?.[base + 2] ?? 0];
}

function appendForce(options: AppendOptions): void {
  const force = finiteVector(options.values, options.base);
  if (force !== undefined) {
    options.records.push({
      node: options.node,
      anchor: options.anchor,
      direction: force.unit,
      length: force.length * options.scale,
      mode: 0,
    });
  }
}

function appendMoment(options: AppendOptions): void {
  const moment = finiteVector(options.values, options.base);
  if (moment !== undefined) {
    options.records.push(...momentArc(options.node, options.anchor, moment, options.scale));
  }
}

function packLoadRecords(
  part: Part,
  records: readonly LoadRecord[],
  displacements: Float32Array | undefined,
): ElementalOrientationRecords {
  const count = records.length;
  const owners = nodeOwners(part);
  const elementIds = new Uint32Array(count);
  const bodyIds = new Uint32Array(count);
  const anchors = new Float32Array(count * 3);
  const referenceLengths = new Float32Array(count);
  const directions = new Float32Array(count * 3);
  const glyphModes = new Uint32Array(count);
  const anchorDeltas = displacements === undefined ? undefined : new Float32Array(count * 3);
  for (const [index, record] of records.entries()) {
    const base = index * 3;
    anchors.set(record.anchor, base);
    directions.set(record.direction, base);
    referenceLengths[index] = record.length;
    glyphModes[index] = record.mode;
    const owner = owners.get(record.node);
    elementIds[index] = owner?.elementId ?? 0;
    bodyIds[index] = owner?.bodyId === undefined ? 0 : owner.bodyId + 1;
    if (anchorDeltas !== undefined) {
      anchorDeltas.set(nodeDelta(displacements ?? new Float32Array(), record.node), base);
    }
  }
  return { elementIds, bodyIds, anchors, referenceLengths, directions, glyphModes, anchorDeltas };
}

function nodeDelta(displacements: Float32Array, node: number): Vec3 {
  const base = node * 3;
  return [
    finiteOrZero(displacements[base]),
    finiteOrZero(displacements[base + 1]),
    finiteOrZero(displacements[base + 2]),
  ];
}

function finiteVector(values: Float32Array, base: number): FiniteVector | undefined {
  const x = values[base] ?? NaN;
  const y = values[base + 1] ?? NaN;
  const z = values[base + 2] ?? NaN;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= ZERO_TOLERANCE) return undefined;
  return { unit: [x / length, y / length, z / length], length };
}

function momentArc(node: number, anchor: Vec3, moment: FiniteVector, scale: number): LoadRecord[] {
  const axis = moment.unit;
  const helper: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = crossUnit(helper, axis);
  const v = crossUnit(axis, u);
  const radius = Math.max(moment.length * scale, 1e-4);
  const records: LoadRecord[] = [];
  for (let index = 0; index < MOMENT_SEGMENTS; index += 1) {
    const startAngle = (index / MOMENT_SEGMENTS) * Math.PI * 1.5;
    const endAngle = ((index + 1) / MOMENT_SEGMENTS) * Math.PI * 1.5;
    const start = arcPoint(anchor, u, v, startAngle, radius);
    const end = arcPoint(anchor, u, v, endAngle, radius);
    const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    records.push({
      node,
      anchor: start,
      direction: normalize(delta),
      length: Math.hypot(...delta),
      mode: index === MOMENT_SEGMENTS - 1 ? 0 : 3,
    });
  }
  return records;
}

function arcPoint(anchor: Vec3, u: Vec3, v: Vec3, angle: number, radius: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    anchor[0] + (u[0] * cosine + v[0] * sine) * radius,
    anchor[1] + (u[1] * cosine + v[1] * sine) * radius,
    anchor[2] + (u[2] * cosine + v[2] * sine) * radius,
  ];
}

function crossUnit(a: Vec3, b: Vec3): Vec3 {
  return normalize([
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]);
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return [value[0] / length, value[1] / length, value[2] / length];
}

function nodeOwners(
  part: Part,
): ReadonlyMap<number, { readonly elementId: number; readonly bodyId: number | undefined }> {
  const owners = new Map<
    number,
    { readonly elementId: number; readonly bodyId: number | undefined }
  >();
  for (const element of part.elements ?? []) {
    for (const range of element.primitiveRanges) {
      const geometry = part.geometries.find((candidate) => candidate.primitive === range.primitive);
      if (geometry === undefined || geometry.nodePickIds === undefined) continue;
      const width = primitiveWidth(range.primitive);
      const start = range.primitiveStart * width;
      const end = (range.primitiveStart + range.primitiveCount) * width;
      for (let index = start; index < end; index += 1) {
        const vertex = geometry.indices[index];
        const pickId = vertex === undefined ? 0 : geometry.nodePickIds[vertex];
        if (pickId !== undefined && pickId > 0 && !owners.has(pickId - 1)) {
          owners.set(pickId - 1, { elementId: element.id, bodyId: element.bodyId });
        }
      }
    }
  }
  return owners;
}

function primitiveWidth(primitive: "triangles" | "lines" | "points"): number {
  return primitive === "triangles" ? 3 : primitive === "lines" ? 2 : 1;
}
