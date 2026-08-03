import type { Mat4 } from "../math/mat4";
import type { Scene } from "../scene/scene";
import type { AssemblyId, PartId } from "../scene/types";
import { compileSceneState, type RuntimeState } from "./compile";
import {
  getDrawList as computeDrawList,
  setAssemblyVisible,
  setInstanceTransform,
  setInstanceVisible,
  setPartVisible,
  type VisibilityDelta,
} from "./visibility";

/**
 * A packed CPU-side view of a scene for rendering: placement transforms,
 * parent relationships, visibility, part references, and stable instance
 * handles stored in typed arrays.
 *
 * Instance ids are stable slots over the full depth-first placement list and
 * never change when visibility changes. The typed arrays are read-only views
 * into the runtime: do not mutate them, or visibleCount desynchronizes.
 */
export interface SceneRuntime {
  readonly rootAssemblyId: AssemblyId;
  /** Number of compiled assembly expansions. */
  readonly nodeCount: number;
  /** Number of part placements; each is a stable instance id in `[0, count)`. */
  readonly instanceCount: number;
  /** Number of currently visible instances. */
  readonly visibleCount: number;
  readonly nodeAssemblyIds: Uint32Array;
  /** Parent node id per node, `-1` for the root. */
  readonly nodeParents: Int32Array;
  /** First child node id per node, `-1` if none. */
  readonly nodeFirstChild: Int32Array;
  /** Next sibling node id per node, `-1` if none. */
  readonly nodeNextSibling: Int32Array;
  /** Subtree instance range `[start, end)` per node, contiguous depth-first. */
  readonly nodeInstanceStart: Uint32Array;
  readonly nodeInstanceEnd: Uint32Array;
  /** Authoring (explicit) visibility per node. */
  readonly nodeVisible: Uint8Array;
  /** Authoring visibility AND every ancestor node. */
  readonly nodeEffectiveVisible: Uint8Array;
  readonly instancePartIds: Uint32Array;
  /** Owning node id per instance. */
  readonly instanceOwningNode: Uint32Array;
  /** Authoring part visibility per instance. */
  readonly instancePartVisible: Uint8Array;
  /** Per-instance override; gates effective visibility. */
  readonly instanceOverrideVisible: Uint8Array;
  /** Effective visibility per instance (override AND part AND hierarchy). */
  readonly instanceVisible: Uint8Array;
  /** Column-major world transform per instance (16 floats). */
  readonly instanceWorldTransforms: Float32Array;
  /** Resolves an instance id to its part id. */
  getPartId(instanceId: number): PartId | undefined;
  /** Returns the world transform of an instance as a matrix view. */
  getTransform(instanceId: number): Mat4 | undefined;
  isInstanceVisible(instanceId: number): boolean;
  /** Returns visible instance ids in deterministic depth-first order. */
  getDrawList(): Uint32Array;
  setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta;
  setPartVisible(partId: PartId, visible: boolean): VisibilityDelta;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta;
  /** Returns false when the instance id is out of range. */
  setInstanceTransform(instanceId: number, transform: Mat4): boolean;
}

/** Compiles a scene into a packed runtime with delta-oriented visibility. */
export function createSceneRuntime(scene: Scene): SceneRuntime {
  const state: RuntimeState = compileSceneState(scene);
  return {
    rootAssemblyId: state.rootAssemblyId,
    nodeCount: state.nodeCount,
    instanceCount: state.instanceCount,
    get visibleCount(): number {
      return state.visibleCount;
    },
    nodeAssemblyIds: state.nodeAssemblyIds,
    nodeParents: state.nodeParents,
    nodeFirstChild: state.nodeFirstChild,
    nodeNextSibling: state.nodeNextSibling,
    nodeInstanceStart: state.nodeInstanceStart,
    nodeInstanceEnd: state.nodeInstanceEnd,
    nodeVisible: state.nodeVisible,
    nodeEffectiveVisible: state.nodeEffectiveVisible,
    instancePartIds: state.instancePartIds,
    instanceOwningNode: state.instanceOwningNode,
    instancePartVisible: state.instancePartVisible,
    instanceOverrideVisible: state.instanceOverrideVisible,
    instanceVisible: state.instanceVisible,
    instanceWorldTransforms: state.instanceWorldTransforms,
    getPartId(instanceId: number): PartId | undefined {
      return state.instancePartIds[instanceId];
    },
    getTransform(instanceId: number): Mat4 | undefined {
      if (instanceId < 0 || instanceId >= state.instanceCount) {
        return undefined;
      }
      return state.instanceWorldTransforms.subarray(instanceId * 16, instanceId * 16 + 16);
    },
    isInstanceVisible(instanceId: number): boolean {
      return (
        instanceId >= 0 &&
        instanceId < state.instanceCount &&
        state.instanceVisible[instanceId] === 1
      );
    },
    getDrawList(): Uint32Array {
      return computeDrawList(state);
    },
    setInstanceVisible(instanceId: number, visible: boolean): VisibilityDelta {
      return setInstanceVisible(state, instanceId, visible);
    },
    setPartVisible(partId: PartId, visible: boolean): VisibilityDelta {
      return setPartVisible(state, partId, visible);
    },
    setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): VisibilityDelta {
      return setAssemblyVisible(state, assemblyId, visible);
    },
    setInstanceTransform(instanceId: number, transform: Mat4): boolean {
      return setInstanceTransform(state, instanceId, transform);
    },
  };
}
