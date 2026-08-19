import type { PartId } from "../geometry/part";
import type { DeformationState } from "../results/deform";
import {
  resolveElementalFrameRecords,
  resolveElementalOrientationRecords,
  type ElementalOrientationRecords,
} from "../results/orientation-records";
import { resolveNodalLoadRecords } from "../results/load-records";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import type {
  ViewportDeformationConfig,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportOrientationState,
  ViewportLoadConfig,
  ViewportResultField,
  ViewportResultsConfig,
} from "./results-types";

const DEFAULT_VECTOR_WIDTH_PIXELS = 2;
const MIN_VECTOR_WIDTH_PIXELS = 1;
const MAX_VECTOR_WIDTH_PIXELS = 8;

export type OrientationRecordMap = ReadonlyMap<PartId, ElementalOrientationRecords>;

export interface ResolvedOrientation {
  readonly state: ViewportOrientationState;
  readonly records: OrientationRecordMap;
}

export interface ResolvedLoads {
  readonly config: ViewportLoadConfig;
  readonly records: OrientationRecordMap;
}

/** Validates the runtime-facing result role boundary before any role is resolved. */
export function validateResultsConfig(config: ViewportResultsConfig): void {
  if (!isRecord(config)) throw new Error("Viewport results config must be an object");
  const roles = config;
  const hasRole =
    roles["scalar"] !== undefined ||
    roles["deformation"] !== undefined ||
    roles["orientation"] !== undefined ||
    roles["loads"] !== undefined;
  if (!hasRole) {
    throw new Error(
      "Viewport results config must include scalar, deformation, orientation, or loads",
    );
  }
  if (roles["scalar"] !== undefined) validateScalarConfig(roles["scalar"]);
  if (roles["deformation"] !== undefined) validateDeformationConfig(roles["deformation"]);
  if (roles["orientation"] !== undefined) validateVectorConfig(roles["orientation"]);
  if (roles["loads"] !== undefined) validateLoadConfig(roles["loads"]);
}

/** Resolves elemental orientation and their renderer-owned per-part records. */
export function resolveOrientation(
  config: ViewportElementVectorConfig | ViewportElementFrameConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation: DeformationState | undefined,
): ResolvedOrientation | undefined {
  if (config === undefined) return undefined;
  const records = new Map<PartId, ElementalOrientationRecords>();
  const lengthScale = config.lengthScale ?? 1;
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    if (config.glyph !== "triad" && config.partId !== undefined && partId !== config.partId)
      continue;
    if (config.glyph === "triad" && partId !== config.field.partId) continue;
    const displacements = deformation?.displacements.get(partId);
    records.set(
      partId,
      decorateRecords(
        config.glyph === "triad"
          ? resolveElementalFrameRecords(part, config.field, displacements, true)
          : resolveElementalOrientationRecords(
              part,
              config.field,
              displacements,
              config.partId !== undefined,
            ),
        config.glyph === "triad" ? 2 : config.glyph === "axis" ? 1 : 0,
        config.glyph === "triad" ? "direction" : config.transform,
        lengthScale,
      ),
    );
  }
  const widthPixels = config.widthPixels ?? DEFAULT_VECTOR_WIDTH_PIXELS;
  if (config.glyph === "triad") {
    return {
      state: {
        config,
        field: config.field,
        glyph: "triad",
        transform: "direction",
        lengthScale,
        widthPixels,
      },
      records,
    };
  }
  return {
    state: {
      config,
      field: config.field,
      glyph: config.glyph,
      transform: config.transform,
      lengthScale,
      widthPixels,
    },
    records,
  };
}

/** Resolves the independent authored nodal-load presentation role. */
export function resolveLoads(
  config: ViewportLoadConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation: DeformationState | undefined,
): ResolvedLoads | undefined {
  if (config === undefined) return undefined;
  const records = new Map<PartId, ElementalOrientationRecords>();
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    if (partId !== config.field.partId) continue;
    records.set(
      partId,
      resolveNodalLoadRecords(
        part,
        config.field,
        deformation?.displacements.get(partId),
        config.forceLengthScale ?? 1,
        config.momentLengthScale ?? 1,
      ),
    );
  }
  return { config, records };
}

function decorateRecords(
  records: ElementalOrientationRecords,
  glyphMode: number,
  transform: "direction" | "normal",
  lengthScale: number,
): ElementalOrientationRecords {
  return {
    ...records,
    glyphModes: new Uint32Array(records.elementIds.length).fill(glyphMode),
    transformModes: new Uint32Array(records.elementIds.length).fill(transform === "normal" ? 1 : 0),
    lengthScales: new Float32Array(records.elementIds.length).fill(lengthScale),
  };
}

/** Returns the distinct part definitions represented by a packed runtime. */
export function renderedPartIds(runtime: PackedSceneRuntime): ReadonlySet<PartId> {
  const partIds = new Set<PartId>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.getPartId(slot);
    if (partId !== undefined) partIds.add(partId);
  }
  return partIds;
}

function validateScalarConfig(value: unknown): void {
  if (!isRecord(value) || !isScalarField(value["field"])) {
    throw new Error("Viewport scalar role requires a nodal or elemental scalar field");
  }
  validateOptionalPartId(value["partId"], "scalar");
}

function validateDeformationConfig(value: unknown): void {
  if (!isRecord(value) || !isNodalVectorField(value["field"])) {
    throw new Error("Viewport deformation role requires a nodal vector field");
  }
}

function validateVectorConfig(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Viewport orientation role requires an elemental vector or frame field");
  }
  if (value["glyph"] === "triad") {
    if (!isElementFrameField(value["field"]))
      throw new Error("Viewport triad role requires an elemental frame field");
  } else if (
    !isElementalVectorField(value["field"]) ||
    (value["glyph"] !== "arrow" && value["glyph"] !== "axis") ||
    (value["transform"] !== "direction" && value["transform"] !== "normal")
  ) {
    throw new Error(
      "Viewport orientation role requires an elemental vector field, glyph arrow/axis, and transform direction/normal",
    );
  }
  if (
    value["lengthScale"] !== undefined &&
    (typeof value["lengthScale"] !== "number" ||
      !Number.isFinite(value["lengthScale"]) ||
      value["lengthScale"] <= 0)
  ) {
    throw new Error("Viewport vector lengthScale must be finite and positive");
  }
  validateOptionalPartId(value["partId"], "vector");
  if (
    value["widthPixels"] !== undefined &&
    (typeof value["widthPixels"] !== "number" ||
      !Number.isFinite(value["widthPixels"]) ||
      value["widthPixels"] < MIN_VECTOR_WIDTH_PIXELS ||
      value["widthPixels"] > MAX_VECTOR_WIDTH_PIXELS)
  ) {
    throw new Error(
      `Viewport vector widthPixels must be finite and between ${MIN_VECTOR_WIDTH_PIXELS} and ${MAX_VECTOR_WIDTH_PIXELS}`,
    );
  }
}

function validateOptionalPartId(value: unknown, role: "scalar" | "vector"): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
    throw new Error(`Viewport ${role} partId must be a non-negative integer`);
  }
}

function validateLoadConfig(value: unknown): void {
  if (!isRecord(value) || !isNodalLoadField(value["field"])) {
    throw new Error("Viewport loads role requires a nodal load field");
  }
  for (const [name, raw] of [
    ["forceLengthScale", value["forceLengthScale"]],
    ["momentLengthScale", value["momentLengthScale"]],
  ] as const) {
    if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)) {
      throw new Error(`Viewport load ${name} must be finite and positive`);
    }
  }
  const width = value["widthPixels"];
  if (
    width !== undefined &&
    (typeof width !== "number" ||
      !Number.isFinite(width) ||
      width < MIN_VECTOR_WIDTH_PIXELS ||
      width > MAX_VECTOR_WIDTH_PIXELS)
  ) {
    throw new Error(
      `Viewport load widthPixels must be finite and between ${MIN_VECTOR_WIDTH_PIXELS} and ${MAX_VECTOR_WIDTH_PIXELS}`,
    );
  }
}

function isScalarField(value: unknown): value is ViewportResultField {
  return (
    isRecord(value) &&
    value["shape"] === "scalar" &&
    (value["location"] === "nodal" || value["location"] === "elemental")
  );
}

function isNodalVectorField(value: unknown): value is ViewportDeformationConfig["field"] {
  return isRecord(value) && value["shape"] === "vector" && value["location"] === "nodal";
}

function isElementalVectorField(value: unknown): value is ViewportElementVectorConfig["field"] {
  return isRecord(value) && value["shape"] === "vector" && value["location"] === "elemental";
}

function isElementFrameField(value: unknown): boolean {
  return isRecord(value) && value["shape"] === "frame" && value["location"] === "elemental";
}

function isNodalLoadField(value: unknown): boolean {
  return isRecord(value) && value["shape"] === "load" && value["location"] === "nodal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
