import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { InstanceStorageOwner } from "../resources/instance-storage";

/** A sparse, deterministic body/element visibility identity for one occurrence. */
export interface VisibilitySignature {
  readonly hash: number;
  readonly bodyIds: readonly number[];
  readonly elementIds: readonly number[] | Uint32Array;
  /** Dense membership by private zero-based element ordinal when cheaper than ids. */
  readonly elementWords?: Uint32Array;
  readonly hasHidden: boolean;
}

/** One compact triangle index order retained for an active visibility signature. */
export interface VisibilitySkin {
  readonly signature: VisibilitySignature;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly byteLength: number;
}

export interface VisibilitySkinEntry {
  readonly skin: VisibilitySkin;
  lastUsed: number;
}

/** Per-part compact-skin cache whose total retained GPU buffers never exceed its budget. */
export interface VisibilitySkinCache {
  readonly entries: Map<number, VisibilitySkinEntry[]>;
  budgetBytes: number;
  residentBytes: number;
  clock: number;
}

/** Surface call fields needed by the visibility grouping owner. */
export interface VisibilityDrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
  readonly firstInstance?: number;
  readonly surfaceSubset?: boolean;
  readonly visibilitySkin?: VisibilitySkin;
}

/** Minimal structural layout consumed by visibility reconciliation. */
export interface VisibilityLayout {
  readonly instanceCount: number;
  readonly slotPartLocal: Int32Array;
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
  readonly partVisibleCounts: Map<PartId, number>;
  readonly partSurfaceDrawCalls: Map<PartId, readonly VisibilityDrawCall[]>;
}

/** Minimal resource owner needed to create and account for a skin. */
export interface VisibilityDrawOwner extends InstanceStorageOwner {
  readonly visibilitySkins: Map<PartId, VisibilitySkinCache>;
}

/** Inputs used by the host-side skin rebuild. */
export interface VisibilitySurfaceOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: VisibilityLayout;
  readonly part: Part;
  readonly interaction: InteractionState;
  readonly draw: VisibilityDrawOwner;
}
