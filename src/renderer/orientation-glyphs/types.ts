import type { PartId } from "../../geometry/part";
import type { ResultBindingId } from "../../results/bindings";
import type { ElementalOrientationRecords } from "../../results/orientation-records";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { OrientationGlyphRecordSource } from "./data";
import type { BufferWritePort } from "../resources/buffer-write-port";

/** Renderer-owned glyph presentation mode. */
export type OrientationGlyphMode = "arrow" | "axis" | "triad";

/** Renderer-owned occurrence direction transform mode. */
export type OrientationGlyphTransform = "direction" | "normal";

/** Internal handoff from the viewport result resolver to the renderer. */
export interface OrientationGlyphState {
  readonly parts: ReadonlyMap<ResultBindingId, ElementalOrientationRecords>;
  readonly mode: OrientationGlyphMode;
  readonly transform: OrientationGlyphTransform;
  readonly lengthScale: number;
  readonly widthPixels: number;
}

/** GPU resources retained for one shared or occurrence-local glyph record array. */
export interface OrientationGlyphGroupResource {
  readonly bindingId: ResultBindingId;
  recordBuffer: GPUBuffer;
  recordData: Uint8Array<ArrayBuffer>;
  recordCapacity: number;
  recordCount: number;
  source: OrientationGlyphRecordSource | undefined;
  orderBuffer: GPUBuffer;
  orderData: Uint32Array;
  orderCapacity: number;
  orderCount: number;
  bindGroup: GPUBindGroup | undefined;
  instanceBindGroup: GPUBindGroup | undefined;
  instanceBindGroupSources: readonly [GPUBuffer, GPUBuffer, GPUBuffer] | undefined;
}

/** Shared transform data and result groups for one reusable part. */
export interface OrientationGlyphPartResource {
  readonly partId: PartId;
  normalBuffer: GPUBuffer;
  normalData: Float32Array;
  normalCapacity: number;
  readonly groups: Map<ResultBindingId, OrientationGlyphGroupResource>;
}

/** Device-bound owner for all active orientation glyph buffers. */
export interface OrientationGlyphDrawResources {
  readonly device: GPUDevice;
  readonly writePort: BufferWritePort;
  readonly cost: GpuCostAccumulator;
  paramsBuffer: GPUBuffer | undefined;
  readonly paramsData: ArrayBuffer;
  readonly parts: Map<PartId, OrientationGlyphPartResource>;
  state: OrientationGlyphState | undefined;
}
