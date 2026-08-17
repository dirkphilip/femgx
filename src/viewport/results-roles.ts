import type { PartId } from "../geometry/part";
import type { DeformationState } from "../results/deform";
import {
  resolveElementalFrameRecords,
  resolveElementalOrientationRecords,
  type ElementalOrientationRecords,
} from "../results/orientation-records";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import type {
  ViewportDeformationConfig,
  ViewportElementFrameConfig,
  ViewportElementVectorConfig,
  ViewportElementVectorState,
  ViewportResultField,
  ViewportResultsConfig,
} from "./results-types";

const DEFAULT_VECTOR_WIDTH_PIXELS = 2;
const MIN_VECTOR_WIDTH_PIXELS = 1;
const MAX_VECTOR_WIDTH_PIXELS = 8;

export type OrientationRecordMap = ReadonlyMap<PartId, ElementalOrientationRecords>;

export interface ResolvedVectors {
  readonly state: ViewportElementVectorState;
  readonly records: OrientationRecordMap;
}

/** Validates the runtime-facing result role boundary before any role is resolved. */
export function validateResultsConfig(config: ViewportResultsConfig): void {
  if (!isRecord(config)) throw new Error("Viewport results config must be an object");
  const roles = config;
  const hasRole =
    roles["scalar"] !== undefined ||
    roles["deformation"] !== undefined ||
    roles["vectors"] !== undefined;
  if (!hasRole) {
    throw new Error("Viewport results config must include scalar, deformation, or vectors");
  }
  if (roles["scalar"] !== undefined) validateScalarConfig(roles["scalar"]);
  if (roles["deformation"] !== undefined) validateDeformationConfig(roles["deformation"]);
  if (roles["vectors"] !== undefined) validateVectorConfig(roles["vectors"]);
}

/** Resolves elemental vectors and their renderer-owned per-part records. */
export function resolveVectors(
  config: ViewportElementVectorConfig | ViewportElementFrameConfig | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  deformation: DeformationState | undefined,
): ResolvedVectors | undefined {
  if (config === undefined) return undefined;
  const records = new Map<PartId, ElementalOrientationRecords>();
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    if (config.glyph === "triad" && partId !== config.field.partId) continue;
    const displacements = deformation?.displacements.get(partId);
    records.set(
      partId,
      config.glyph === "triad"
        ? resolveElementalFrameRecords(part, config.field, displacements)
        : resolveElementalOrientationRecords(part, config.field, displacements),
    );
  }
  const lengthScale = config.lengthScale ?? 1;
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
}

function validateDeformationConfig(value: unknown): void {
  if (!isRecord(value) || !isNodalVectorField(value["field"])) {
    throw new Error("Viewport deformation role requires a nodal vector field");
  }
}

function validateVectorConfig(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Viewport vectors role requires an elemental vector or frame field");
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
      "Viewport vectors role requires an elemental vector field, glyph arrow/axis, and transform direction/normal",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
