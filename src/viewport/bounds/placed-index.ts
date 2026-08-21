import { isFiniteBounds, type Bounds, type Part, type PartId } from "../../geometry/part";
import { transformPoint } from "../../math/mat4";
import { nextPowerOfTwo } from "../../math/scalar";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import { displayedPartBounds } from "../geometry-bounds";

const MINIMUM_BOUNDS: Bounds = {
  minX: -0.5,
  minY: -0.5,
  minZ: -0.5,
  maxX: 0.5,
  maxY: 0.5,
  maxZ: 0.5,
};

/** Private segment tree for complete placed-scene bounds under incremental transforms. */
export class PlacedBoundsIndex {
  public lastUpdatedLeafCount = 0;
  private leafCapacity: number;
  private minX: Float64Array;
  private minY: Float64Array;
  private minZ: Float64Array;
  private maxX: Float64Array;
  private maxY: Float64Array;
  private maxZ: Float64Array;
  private readonly partBounds = new Map<PartId, Bounds | undefined>();
  private parts: ReadonlyMap<PartId, Part>;

  constructor(scene: Scene, runtime: PackedSceneRuntime) {
    this.parts = scene.parts;
    this.leafCapacity = nextPowerOfTwo(Math.max(1, runtime.instanceCount));
    const size = this.leafCapacity * 2;
    this.minX = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.minY = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.minZ = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.maxX = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    this.maxY = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    this.maxZ = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    for (let slot = 0; slot < runtime.instanceCount; slot += 1) this.writeLeaf(runtime, slot);
    for (let node = this.leafCapacity - 1; node > 0; node -= 1) this.merge(node);
  }

  /** Admits changed immutable definitions without rebuilding retained placed bounds. */
  updateParts(parts: ReadonlyMap<PartId, Part>, partIds: ReadonlySet<PartId>): void {
    this.parts = parts;
    for (const partId of partIds) this.partBounds.delete(partId);
  }

  /** Updates changed occurrence leaves and their logarithmic ancestor paths. */
  update(runtime: PackedSceneRuntime, changedSlots: readonly number[]): void {
    this.lastUpdatedLeafCount = 0;
    if (runtime.instanceCount > this.leafCapacity) {
      this.rebuild(runtime);
      return;
    }
    for (const slot of changedSlots) {
      if (slot < 0 || slot >= runtime.instanceCount) continue;
      this.lastUpdatedLeafCount += 1;
      this.writeLeaf(runtime, slot);
      for (let node = (this.leafCapacity + slot) >> 1; node > 0; node >>= 1) {
        this.merge(node);
      }
    }
  }

  get bounds(): Bounds {
    const bounds = {
      minX: this.minX[1] ?? Number.POSITIVE_INFINITY,
      minY: this.minY[1] ?? Number.POSITIVE_INFINITY,
      minZ: this.minZ[1] ?? Number.POSITIVE_INFINITY,
      maxX: this.maxX[1] ?? Number.NEGATIVE_INFINITY,
      maxY: this.maxY[1] ?? Number.NEGATIVE_INFINITY,
      maxZ: this.maxZ[1] ?? Number.NEGATIVE_INFINITY,
    };
    return isFiniteBounds(bounds) ? bounds : MINIMUM_BOUNDS;
  }

  private writeLeaf(runtime: PackedSceneRuntime, slot: number): void {
    const node = this.leafCapacity + slot;
    this.minX[node] = this.minY[node] = this.minZ[node] = Number.POSITIVE_INFINITY;
    this.maxX[node] = this.maxY[node] = this.maxZ[node] = Number.NEGATIVE_INFINITY;
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const local = partId === undefined ? undefined : this.localBounds(partId);
    if (local === undefined || transform === undefined || !isFiniteBounds(local)) return;
    const world = transformBounds(local, transform);
    this.minX[node] = world.minX;
    this.minY[node] = world.minY;
    this.minZ[node] = world.minZ;
    this.maxX[node] = world.maxX;
    this.maxY[node] = world.maxY;
    this.maxZ[node] = world.maxZ;
  }

  private rebuild(runtime: PackedSceneRuntime): void {
    this.lastUpdatedLeafCount = runtime.instanceCount;
    this.leafCapacity = nextPowerOfTwo(Math.max(1, runtime.instanceCount));
    const size = this.leafCapacity * 2;
    this.minX = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.minY = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.minZ = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    this.maxX = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    this.maxY = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    this.maxZ = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
    for (let slot = 0; slot < runtime.instanceCount; slot += 1) this.writeLeaf(runtime, slot);
    for (let node = this.leafCapacity - 1; node > 0; node -= 1) this.merge(node);
  }

  private localBounds(partId: PartId): Bounds | undefined {
    if (!this.partBounds.has(partId)) {
      const part = this.parts.get(partId);
      this.partBounds.set(
        partId,
        part === undefined ? undefined : displayedPartBounds(part, undefined),
      );
    }
    return this.partBounds.get(partId);
  }

  private merge(node: number): void {
    const left = node * 2;
    const right = left + 1;
    this.minX[node] = Math.min(this.minX[left] ?? Infinity, this.minX[right] ?? Infinity);
    this.minY[node] = Math.min(this.minY[left] ?? Infinity, this.minY[right] ?? Infinity);
    this.minZ[node] = Math.min(this.minZ[left] ?? Infinity, this.minZ[right] ?? Infinity);
    this.maxX[node] = Math.max(this.maxX[left] ?? -Infinity, this.maxX[right] ?? -Infinity);
    this.maxY[node] = Math.max(this.maxY[left] ?? -Infinity, this.maxY[right] ?? -Infinity);
    this.maxZ[node] = Math.max(this.maxZ[left] ?? -Infinity, this.maxZ[right] ?? -Infinity);
  }
}

function transformBounds(bounds: Bounds, transform: Float32Array): Bounds {
  const xs = [bounds.minX, bounds.maxX] as const;
  const ys = [bounds.minY, bounds.maxY] as const;
  const zs = [bounds.minZ, bounds.maxZ] as const;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const x of xs)
    for (const y of ys)
      for (const z of zs) {
        const [tx, ty, tz] = transformPoint(transform, x, y, z);
        minX = Math.min(minX, tx);
        minY = Math.min(minY, ty);
        minZ = Math.min(minZ, tz);
        maxX = Math.max(maxX, tx);
        maxY = Math.max(maxY, ty);
        maxZ = Math.max(maxZ, tz);
      }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
