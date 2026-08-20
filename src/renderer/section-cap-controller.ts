import type { InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Part, PartId } from "../geometry/part";
import type { SectionPlane } from "../math/section-plane";
import type { DeformationState } from "../results/deform";
import {
  buildSectionCapFrame,
  destroySectionCapFrame,
  filterSectionCapFrame,
  syncSectionCapStyles,
  type SectionCapFrame,
} from "./section-caps";
import {
  sectionCapVisibilityCanOnlyReduce,
  sectionCapVisibilityChanged,
} from "./section-cap-interaction";
import {
  destroyInstancePartResources,
  destroyPartResources,
  type DrawCall,
  type DrawResources,
} from "./resources/draw-resources";
import type { ResultColorMap } from "../results/colors";
import type { RuntimeOccurrenceDelta } from "../scene-runtime/occurrence-update";

interface SectionCapSyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly plane: SectionPlane | undefined;
  readonly interaction: InteractionState;
  readonly deformation: DeformationState | undefined;
  readonly resultColors: ResultColorMap | undefined;
  readonly draw: DrawResources;
}

/** Owns invalidation and source-independent renderer-private cap state. */
export class SectionCapController {
  private frame: SectionCapFrame | undefined;
  private retained: SectionCapFrame | undefined;
  private runtime: PackedSceneRuntime | undefined;
  private interaction: InteractionState | undefined;
  private dirty = true;
  private rebuildUsingRetained = false;
  private renderedParts: ReadonlyMap<PartId, Part> = new Map();
  private sourceColors: ResultColorMap | undefined;
  private renderedColors: ResultColorMap | undefined;

  public get currentFrame(): SectionCapFrame | undefined {
    return this.frame;
  }

  public get parts(): ReadonlyMap<PartId, Part> {
    return this.renderedParts;
  }

  public get resultColors(): ResultColorMap | undefined {
    return this.renderedColors;
  }

  public invalidate(): void {
    this.dirty = true;
    this.rebuildUsingRetained = false;
  }

  /** Applies interaction presentation changes to retained caps without rebuilding geometry. */
  public syncStyles(
    runtime: PackedSceneRuntime,
    parts: ReadonlyMap<PartId, Part>,
    interaction: InteractionState,
    draw: DrawResources,
  ): void {
    if (this.frame === undefined || this.runtime !== runtime || this.dirty) return;
    const calls = syncSectionCapStyles({ frame: this.frame, runtime, parts, interaction, draw });
    if (
      !sameCalls(this.frame.calls, calls.calls) ||
      !sameCalls(this.frame.transparentCalls, calls.transparentCalls)
    ) {
      this.frame = { ...this.frame, ...calls };
    }
    this.interaction = interaction;
  }

  /** Keeps cap geometry only when interaction changes do not alter visibility admission. */
  public syncInteraction(
    interaction: InteractionState,
    runtime: PackedSceneRuntime,
    parts: ReadonlyMap<PartId, Part>,
    draw: DrawResources,
  ): void {
    if (this.interaction === interaction) return;
    if (this.frame === undefined || this.retained === undefined || this.retained.parts.size === 0) {
      this.interaction = interaction;
      return;
    }
    const previous = this.interaction;
    if (previous === undefined || !sectionCapVisibilityChanged(previous, interaction)) {
      this.syncStyles(runtime, parts, interaction, draw);
      return;
    }
    if (!this.canReuseInteractionFrame(previous, runtime)) {
      if (this.dirty && this.rebuildUsingRetained) {
        this.interaction = interaction;
        return;
      }
      this.invalidate();
      return;
    }
    if (sectionCapVisibilityCanOnlyReduce(previous, interaction)) {
      this.frame = filterSectionCapFrame({ frame: this.frame, runtime, parts, interaction, draw });
      this.interaction = interaction;
      this.updateRenderedParts(parts);
      return;
    }
    this.dirty = true;
    this.rebuildUsingRetained = true;
  }

  /** Applies occurrence changes while retiring exact removed-part cap fragments. */
  public updateOccurrences(
    delta: RuntimeOccurrenceDelta,
    parts: ReadonlyMap<PartId, Part>,
    draw: DrawResources,
  ): void {
    this.removeParts(delta.removedPartIds, parts, draw);
    if ([...delta.affectedPartIds].some((partId) => !delta.removedPartIds.has(partId))) {
      this.invalidate();
    }
  }

  /** Rebuilds only cap fragments whose source immutable part definition changed. */
  public replaceParts(
    partIds: ReadonlySet<PartId>,
    parts: ReadonlyMap<PartId, Part>,
    draw: DrawResources,
  ): void {
    this.removeParts(partIds, parts, draw);
    this.dirty = true;
    this.rebuildUsingRetained = true;
  }

  public sync(options: SectionCapSyncOptions): void {
    if (options.plane === undefined) {
      this.release(options.draw);
      this.runtime = options.runtime;
      this.interaction = options.interaction;
      this.sourceColors = options.resultColors;
      this.dirty = false;
      this.renderedParts = options.parts;
      this.renderedColors = options.resultColors;
      return;
    }
    if (!this.dirty && this.runtime === options.runtime) return;
    this.sourceColors = options.resultColors;
    const reusable = this.rebuildUsingRetained ? this.retained : undefined;
    if (reusable === undefined) this.release(options.draw);
    const frame = buildSectionCapFrame({
      runtime: options.runtime,
      parts: options.parts,
      plane: options.plane,
      interaction: options.interaction,
      deformation: options.deformation,
      resultColors: options.resultColors,
      draw: options.draw,
      ...(reusable === undefined ? {} : { reusable }),
    });
    if (reusable !== undefined) destroyRemovedCaps(reusable, frame, options.draw);
    this.frame = frame;
    this.retained = frame;
    this.runtime = options.runtime;
    this.interaction = options.interaction;
    this.dirty = false;
    this.rebuildUsingRetained = false;
    this.updateRenderedParts(options.parts, options.resultColors);
  }

  public reset(draw: DrawResources): void {
    this.release(draw);
    this.runtime = undefined;
    this.interaction = undefined;
    this.dirty = true;
    this.renderedParts = new Map();
    this.sourceColors = undefined;
    this.renderedColors = undefined;
  }

  /** Drops stale references after the lifecycle has destroyed the old bundle. */
  public recover(parts: ReadonlyMap<PartId, Part>, colors: ResultColorMap | undefined): void {
    this.frame = undefined;
    this.retained = undefined;
    this.runtime = undefined;
    this.interaction = undefined;
    this.dirty = true;
    this.renderedParts = parts;
    this.sourceColors = colors;
    this.renderedColors = colors;
  }

  private release(draw: DrawResources): void {
    const frame = this.retained ?? this.frame;
    if (frame === undefined) return;
    destroySectionCapFrame(frame, draw);
    this.frame = undefined;
    this.retained = undefined;
    this.rebuildUsingRetained = false;
  }

  private canReuseInteractionFrame(
    previous: InteractionState,
    runtime: PackedSceneRuntime,
  ): boolean {
    return (
      !this.dirty &&
      this.frame !== undefined &&
      this.retained !== undefined &&
      this.runtime === runtime &&
      this.interaction === previous
    );
  }

  private updateRenderedParts(
    parts: ReadonlyMap<PartId, Part>,
    colors: ResultColorMap | undefined = this.sourceColors,
  ): void {
    const frame = this.frame;
    this.renderedParts =
      frame === undefined || frame.parts.size === 0 ? parts : new Map([...parts, ...frame.parts]);
    this.renderedColors =
      frame === undefined || frame.resultColors.size === 0
        ? colors
        : new Map([...(colors ?? []), ...frame.resultColors]);
  }

  private removeParts(
    partIds: ReadonlySet<PartId>,
    parts: ReadonlyMap<PartId, Part>,
    draw: DrawResources,
  ): void {
    if (partIds.size === 0) {
      this.invalidate();
      return;
    }
    const frame = this.frame;
    const retained = this.retained;
    if (frame === undefined || retained === undefined) {
      this.renderedParts = parts;
      this.renderedColors = retainedEntries(this.renderedColors, partIds);
      return;
    }
    const capIds = new Set(
      [...retained.sourcePartIds].flatMap(([capId, sourceId]) =>
        partIds.has(sourceId) ? [capId] : [],
      ),
    );
    for (const capId of capIds) {
      destroyPartResources(draw, capId);
      destroyInstancePartResources(draw, capId);
    }
    this.retained = withoutCaps(retained, capIds);
    this.frame = frame === retained ? this.retained : withoutCaps(frame, capIds);
    const capParts = this.frame.parts;
    this.renderedParts = new Map([...parts, ...capParts]);
    this.renderedColors = retainedEntries(this.renderedColors, new Set([...partIds, ...capIds]));
  }
}

function destroyRemovedCaps(
  previous: SectionCapFrame,
  next: SectionCapFrame,
  draw: DrawResources,
): void {
  for (const partId of previous.parts.keys()) {
    if (next.parts.has(partId)) continue;
    destroyPartResources(draw, partId);
    destroyInstancePartResources(draw, partId);
  }
}

function withoutCaps(frame: SectionCapFrame, capIds: ReadonlySet<PartId>): SectionCapFrame {
  return {
    parts: retainedEntries(frame.parts, capIds),
    sourcePartIds: retainedEntries(frame.sourcePartIds, capIds),
    sourceSlots: retainedEntries(frame.sourceSlots, capIds),
    calls: retainedCalls(frame.calls, capIds),
    transparentCalls: retainedCalls(frame.transparentCalls, capIds),
    allCalls: retainedCalls(frame.allCalls, capIds),
    resultColors: retainedEntries(frame.resultColors, capIds),
  };
}

function sameCalls(left: readonly DrawCall[], right: readonly DrawCall[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.partId !== right[index]?.partId) return false;
  }
  return true;
}

function retainedEntries<K, V>(values: ReadonlyMap<K, V>, removed: ReadonlySet<K>): Map<K, V>;
function retainedEntries<K, V>(
  values: ReadonlyMap<K, V> | undefined,
  removed: ReadonlySet<K>,
): Map<K, V> | undefined;
function retainedEntries<K, V>(
  values: ReadonlyMap<K, V> | undefined,
  removed: ReadonlySet<K>,
): Map<K, V> | undefined {
  return values === undefined
    ? undefined
    : new Map([...values].filter(([key]) => !removed.has(key)));
}

function retainedCalls<T extends { readonly partId: PartId }>(
  calls: readonly T[],
  removed: ReadonlySet<PartId>,
): T[] {
  return calls.filter(({ partId }) => !removed.has(partId));
}

/** Compares section-plane values without requiring a new object identity. */
export function sameSectionPlane(
  left: SectionPlane | undefined,
  right: SectionPlane | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.distance === right.distance &&
      left.normal[0] === right.normal[0] &&
      left.normal[1] === right.normal[1] &&
      left.normal[2] === right.normal[2])
  );
}
