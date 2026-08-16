import type { InteractionState } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Part, PartId } from "../geometry/part";
import type { SectionPlane } from "../math/section-plane";
import type { DeformationState } from "../results/deform";
import { buildSectionCapFrame, destroySectionCapFrame, type SectionCapFrame } from "./section-caps";
import type { DrawResources } from "./resources/draw-resources";

interface SectionCapSyncOptions {
  readonly runtime: PackedSceneRuntime;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly plane: SectionPlane | undefined;
  readonly interaction: InteractionState;
  readonly deformation: DeformationState | undefined;
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
  readonly draw: DrawResources;
}

/** Owns invalidation and source-independent renderer-private cap state. */
export class SectionCapController {
  private frame: SectionCapFrame | undefined;
  private runtime: PackedSceneRuntime | undefined;
  private dirty = true;
  private renderedParts: ReadonlyMap<PartId, Part> = new Map();
  private renderedColors: ReadonlyMap<PartId, Float32Array> | undefined;

  public get currentFrame(): SectionCapFrame | undefined {
    return this.frame;
  }

  public get parts(): ReadonlyMap<PartId, Part> {
    return this.renderedParts;
  }

  public get resultColors(): ReadonlyMap<PartId, Float32Array> | undefined {
    return this.renderedColors;
  }

  public invalidate(): void {
    this.dirty = true;
  }

  public sync(options: SectionCapSyncOptions): void {
    if (options.plane === undefined) {
      this.release(options.draw);
      this.runtime = options.runtime;
      this.dirty = false;
      this.renderedParts = options.parts;
      this.renderedColors = options.resultColors;
      return;
    }
    if (!this.dirty && this.runtime === options.runtime) return;
    this.release(options.draw);
    const frame = buildSectionCapFrame({
      runtime: options.runtime,
      parts: options.parts,
      plane: options.plane,
      interaction: options.interaction,
      deformation: options.deformation,
      resultColors: options.resultColors,
      draw: options.draw,
    });
    this.frame = frame;
    this.runtime = options.runtime;
    this.dirty = false;
    this.renderedParts =
      frame.parts.size === 0 ? options.parts : new Map([...options.parts, ...frame.parts]);
    this.renderedColors =
      frame.resultColors.size === 0
        ? options.resultColors
        : new Map([...(options.resultColors ?? []), ...frame.resultColors]);
  }

  public reset(draw: DrawResources): void {
    this.release(draw);
    this.runtime = undefined;
    this.dirty = true;
    this.renderedParts = new Map();
    this.renderedColors = undefined;
  }

  /** Drops stale references after the lifecycle has destroyed the old bundle. */
  public recover(
    parts: ReadonlyMap<PartId, Part>,
    colors: ReadonlyMap<PartId, Float32Array> | undefined,
  ): void {
    this.frame = undefined;
    this.runtime = undefined;
    this.dirty = true;
    this.renderedParts = parts;
    this.renderedColors = colors;
  }

  private release(draw: DrawResources): void {
    if (this.frame === undefined) return;
    destroySectionCapFrame(this.frame, draw);
    this.frame = undefined;
  }
}
