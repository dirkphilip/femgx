import type { PartId } from "../geometry/part";
import type { DeformationState } from "../results/deform";
import type { ResultBindingId } from "../results/bindings";
import {
  resolveElementalFrameRecords,
  resolveElementalOrientationRecords,
  type ElementalOrientationRecords,
} from "../results/orientation-records";
import { resolveNodalLoadRecords } from "../results/load-records";
import type { Scene } from "../scene/scene";
import type { PartOccurrenceId } from "../scene/types";
import type { ResultResolutionView } from "./results/resolution-view";
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

export type OrientationRecordMap = ReadonlyMap<ResultBindingId, ElementalOrientationRecords>;

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
  const occurrences = roles["occurrences"];
  if (!hasRole && (!Array.isArray(occurrences) || occurrences.length === 0)) {
    throw new Error(
      "Viewport results config must include a shared or occurrence-bound scalar, deformation, orientation, or loads role",
    );
  }
  validateRoleSet(roles, "shared snapshot");
  if (occurrences !== undefined) validateOccurrences(occurrences);
}

function validateOccurrences(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("Viewport result occurrences must be an array");
  const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["partOccurrenceId"] !== "string") {
      throw new Error("Viewport occurrence results require a partOccurrenceId");
    }
    const id = entry["partOccurrenceId"];
    if (id.length === 0) throw new Error("Viewport occurrence partOccurrenceId must not be empty");
    if (ids.has(id)) throw new Error(`Viewport occurrence ${id} is bound more than once`);
    ids.add(id);
    if (
      entry["scalar"] === undefined &&
      entry["deformation"] === undefined &&
      entry["orientation"] === undefined &&
      entry["loads"] === undefined
    ) {
      throw new Error(`Viewport occurrence ${id} must include at least one result role`);
    }
    validateRoleSet(entry, `occurrence ${id}`);
    if (isRecord(entry["scalar"]) && entry["scalar"]["partId"] !== undefined) {
      throw new Error(`Viewport occurrence ${id} scalar role must not specify partId`);
    }
    if (isRecord(entry["orientation"]) && entry["orientation"]["partId"] !== undefined) {
      throw new Error(`Viewport occurrence ${id} orientation role must not specify partId`);
    }
  }
}

function validateRoleSet(roles: Record<string, unknown>, context: string): void {
  try {
    if (roles["scalar"] !== undefined) validateScalarConfig(roles["scalar"]);
    if (roles["deformation"] !== undefined) validateDeformationConfig(roles["deformation"]);
    if (roles["orientation"] !== undefined) validateVectorConfig(roles["orientation"]);
    if (roles["loads"] !== undefined) validateLoadConfig(roles["loads"]);
  } catch (error) {
    throw new Error(`Invalid viewport results ${context}: ${String(error)}`, { cause: error });
  }
}

/** Resolves elemental orientation and their renderer-owned per-part records. */
export function resolveOrientation(
  config: ViewportElementVectorConfig | ViewportElementFrameConfig | undefined,
  scene: Scene,
  view: ResultResolutionView,
  deformation: DeformationState | undefined,
  target?: { readonly partId: PartId; readonly bindingId: PartOccurrenceId },
): ResolvedOrientation | undefined {
  if (config === undefined) return undefined;
  const records = new Map<ResultBindingId, ElementalOrientationRecords>();
  const lengthScale = config.lengthScale ?? 1;
  for (const partId of target === undefined ? view.renderedPartIds : [target.partId]) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    if (config.glyph !== "triad" && config.partId !== undefined && partId !== config.partId)
      continue;
    if (config.glyph === "triad" && partId !== config.field.partId) continue;
    const displacements =
      target === undefined
        ? deformation?.displacements.get(partId)
        : (deformation?.displacements.get(target.bindingId) ??
          deformation?.displacements.get(partId));
    records.set(
      target?.bindingId ?? partId,
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
  return { state: orientationState(config, lengthScale, widthPixels), records };
}

function orientationState(
  config: ViewportElementVectorConfig | ViewportElementFrameConfig,
  lengthScale: number,
  widthPixels: number,
): ViewportOrientationState {
  return config.glyph === "triad"
    ? {
        config,
        field: config.field,
        glyph: "triad",
        transform: "direction",
        lengthScale,
        widthPixels,
      }
    : {
        config,
        field: config.field,
        glyph: config.glyph,
        transform: config.transform,
        lengthScale,
        widthPixels,
      };
}

/** Resolves the independent authored nodal-load presentation role. */
export function resolveLoads(
  config: ViewportLoadConfig | undefined,
  scene: Scene,
  view: ResultResolutionView,
  deformation: DeformationState | undefined,
  target?: { readonly partId: PartId; readonly bindingId: PartOccurrenceId },
): ResolvedLoads | undefined {
  if (config === undefined) return undefined;
  const records = new Map<ResultBindingId, ElementalOrientationRecords>();
  for (const partId of target === undefined ? view.renderedPartIds : [target.partId]) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    if (partId !== config.field.partId) continue;
    records.set(
      target?.bindingId ?? partId,
      resolveNodalLoadRecords(
        part,
        config.field,
        target === undefined
          ? deformation?.displacements.get(partId)
          : (deformation?.displacements.get(target.bindingId) ??
              deformation?.displacements.get(partId)),
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
