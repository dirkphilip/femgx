import type { PartId } from "../geometry/part";
import { getPartSemanticIndex, type PartSemanticIndex } from "../geometry/part-semantic-index";
import type { BodyId } from "../geometry/part";
import { readInteractionState } from "../interaction/state";
import type { BodyRef } from "../interaction/refs";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { ElementId, ElementRef } from "../scene/types";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { SceneNavigationBoundsCache } from "./scene-bounds";
import type { ViewportSceneController } from "./scene-controller";
import type { Viewport } from "./types";
import { UnknownSceneIdentityError } from "./visibility-error";
import { registerViewportVisibilityPolicy } from "./visibility/policy";

interface VisibilityControllerOptions {
  readonly viewport?: Viewport;
  readonly sceneController: ViewportSceneController;
  readonly renderer: WebGpuRenderer;
  readonly isBatching: () => boolean;
  readonly invalidate: () => void;
  readonly navigationBoundsCache: SceneNavigationBoundsCache;
}

/** Owns viewport visibility mutations and their deferred renderer updates. */
export class ViewportVisibilityController {
  private readonly pendingVisibility = new Set<PartId>();
  private readonly pendingInteractionSlots = new Set<number>();

  constructor(private readonly options: VisibilityControllerOptions) {
    if (options.viewport !== undefined)
      registerViewportVisibilityPolicy(options.viewport, () =>
        options.sceneController.visibility.snapshot(),
      );
  }

  setPartVisible(partId: PartId, visible: boolean): void {
    if (!this.options.sceneController.scene.parts.has(partId)) {
      throw new UnknownSceneIdentityError("part", partId);
    }
    const runtime = this.options.sceneController.runtime;
    this.applyChanged(
      this.options.sceneController.visibility.setPartVisible(runtime, partId, visible)
        .affectedPartIds,
    );
  }

  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    const runtime = this.options.sceneController.runtime;
    const node = runtime.getNodeSlot(occurrenceId);
    if (node === undefined)
      throw new UnknownSceneIdentityError("assembly-occurrence", occurrenceId);
    this.applyChanged(
      this.options.sceneController.visibility.setAssemblyOccurrenceVisible(
        runtime,
        occurrenceId,
        node,
        visible,
      ).affectedPartIds,
    );
  }

  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    if (!this.options.sceneController.scene.assemblies.has(assemblyId)) {
      throw new UnknownSceneIdentityError("assembly", assemblyId);
    }
    const runtime = this.options.sceneController.runtime;
    this.applyChanged(
      this.options.sceneController.visibility.setAssemblyVisible(runtime, assemblyId, visible)
        .affectedPartIds,
    );
  }

  setPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId, visible: boolean): void {
    this.setPartOccurrences([partOccurrenceId], visible);
  }

  setPartOccurrences(partOccurrenceIds: Iterable<PartOccurrenceId>, visible: boolean): void {
    const runtime = this.options.sceneController.runtime;
    const slots: number[] = [];
    const seen = new Uint8Array(runtime.instanceCount);
    for (const occurrenceId of partOccurrenceIds) {
      const slot = runtime.getInstanceSlot(occurrenceId);
      if (slot === undefined) throw new UnknownSceneIdentityError("partOccurrence", occurrenceId);
      if (seen[slot] === 1) continue;
      seen[slot] = 1;
      slots.push(slot);
    }
    this.applyChanged(
      this.options.sceneController.visibility.setPartOccurrences(runtime, slots, visible)
        .affectedPartIds,
    );
  }

  setBodyVisible(ref: BodyRef, visible: boolean): void {
    const resolved = this.resolveBody(ref);
    if (!this.options.sceneController.visibility.setBodyVisible(ref, visible)) return;
    this.options.sceneController.markVisibilityChanged();
    this.applyPrimitiveChanged(resolved.partId);
  }

  setElementVisible(ref: ElementRef, visible: boolean): void {
    const resolved = this.resolveElement(ref);
    if (!this.options.sceneController.visibility.setElementVisible(ref, visible)) return;
    this.options.sceneController.markVisibilityChanged();
    this.applyPrimitiveChanged(resolved.partId);
  }

  setBodiesVisible(refs: Iterable<BodyRef>, visible: boolean): void {
    const grouped = new Map<PartOccurrenceId, Set<BodyId>>();
    const partIds = new Set<PartId>();
    for (const ref of refs) {
      const resolved = this.resolveBody(ref);
      const ids = grouped.get(ref.partOccurrenceId) ?? new Set<BodyId>();
      ids.add(ref.bodyId);
      grouped.set(ref.partOccurrenceId, ids);
      partIds.add(resolved.partId);
    }
    if (!this.options.sceneController.visibility.setBodiesVisible(grouped, visible)) return;
    this.options.sceneController.markVisibilityChanged();
    this.applyPrimitiveChanged(partIds);
  }

  setElementsVisible(refs: Iterable<ElementRef>, visible: boolean): void {
    const grouped = new Map<PartOccurrenceId, Set<ElementId>>();
    const partIds = new Set<PartId>();
    for (const ref of refs) {
      const resolved = this.resolveElement(ref);
      const ids = grouped.get(ref.partOccurrenceId) ?? new Set<ElementId>();
      ids.add(ref.elementId);
      grouped.set(ref.partOccurrenceId, ids);
      partIds.add(resolved.partId);
    }
    if (!this.options.sceneController.visibility.setElementsVisible(grouped, visible)) return;
    this.options.sceneController.markVisibilityChanged();
    this.applyPrimitiveChanged(partIds);
  }

  hideSelectedElements(): void {
    const selected = readInteractionState(
      this.options.sceneController.interaction,
    ).selectedElementIds;
    const refs: ElementRef[] = [];
    for (const [partOccurrenceId, elementIds] of selected) {
      for (const elementId of elementIds) refs.push({ partOccurrenceId, elementId });
    }
    this.setElementsVisible(refs, false);
  }

  showAll(): void {
    const changed = this.options.sceneController.visibility.showAll(
      this.options.sceneController.runtime,
    );
    if (changed.length === 0) return;
    this.options.sceneController.markVisibilityChanged();
    this.applyChanged(changed);
  }

  isBodyDirectlyVisible(ref: BodyRef): boolean {
    this.resolveBody(ref);
    return this.options.sceneController.visibility.isBodyVisible(ref);
  }

  isElementDirectlyVisible(ref: ElementRef): boolean {
    this.resolveElement(ref);
    return this.options.sceneController.visibility.isElementVisible(ref);
  }

  isBodyEffectivelyVisible(ref: BodyRef): boolean {
    const resolved = this.resolveBody(ref);
    return (
      this.options.sceneController.runtime.isInstanceVisible(resolved.slot) &&
      this.options.sceneController.visibility.isBodyVisible(ref)
    );
  }

  isElementEffectivelyVisible(ref: ElementRef): boolean {
    const resolved = this.resolveElement(ref);
    const bodyId = resolved.semantic.bodyForElement(ref.elementId);
    return (
      this.options.sceneController.runtime.isInstanceVisible(resolved.slot) &&
      this.options.sceneController.visibility.isElementVisible(ref) &&
      (bodyId === undefined ||
        this.options.sceneController.visibility.isBodyVisible({
          partOccurrenceId: ref.partOccurrenceId,
          bodyId,
        }))
    );
  }

  reset(): void {
    this.pendingVisibility.clear();
    this.pendingInteractionSlots.clear();
  }

  flush(): void {
    if (this.pendingVisibility.size === 0 && this.pendingInteractionSlots.size === 0) return;
    const changed = [...this.pendingVisibility].sort((a, b) => a - b);
    this.pendingVisibility.clear();
    if (changed.length > 0)
      this.options.renderer.updateVisibility(this.options.sceneController.runtime, changed);
    const interactionSlots = [...this.pendingInteractionSlots].sort((a, b) => a - b);
    this.pendingInteractionSlots.clear();
    if (interactionSlots.length > 0) {
      const runtime = this.options.sceneController.runtime;
      const interaction = this.options.sceneController.rendererInteraction;
      this.options.renderer.updateInstances(runtime, interaction, interactionSlots);
      this.options.renderer.updateElements(runtime, interaction, interactionSlots);
    }
  }

  private applyPrimitiveChanged(partIds: PartId | ReadonlySet<PartId>): void {
    const ids = new Set<PartId>();
    if (typeof partIds === "number") {
      ids.add(partIds);
    } else {
      for (const partId of partIds) ids.add(partId);
    }
    const runtime = this.options.sceneController.runtime;
    const slots = new Set<number>();
    for (const partId of ids)
      for (const slot of runtime.getPartInstanceSlots(partId)) slots.add(slot);
    if (this.options.isBatching()) {
      for (const slot of slots) this.pendingInteractionSlots.add(slot);
    } else if (slots.size > 0) {
      const changed = [...slots].sort((a, b) => a - b);
      const interaction = this.options.sceneController.rendererInteraction;
      this.options.renderer.updateInstances(runtime, interaction, changed);
      this.options.renderer.updateElements(runtime, interaction, changed);
    }
    this.options.navigationBoundsCache.invalidate();
    this.options.invalidate();
  }

  private resolveBody(ref: BodyRef): ResolvedPrimitive {
    const resolved = this.resolveOccurrence(ref.partOccurrenceId);
    if (!resolved.semantic.hasBody(ref.bodyId)) {
      throw new UnknownSceneIdentityError("body", ref.bodyId);
    }
    return resolved;
  }

  private resolveElement(ref: ElementRef): ResolvedPrimitive {
    const resolved = this.resolveOccurrence(ref.partOccurrenceId);
    if (!resolved.semantic.hasElement(ref.elementId)) {
      throw new UnknownSceneIdentityError("element", ref.elementId);
    }
    return resolved;
  }

  private resolveOccurrence(partOccurrenceId: PartOccurrenceId): ResolvedPrimitive {
    const runtime = this.options.sceneController.runtime;
    const slot = runtime.getInstanceSlot(partOccurrenceId);
    const partId = slot === undefined ? undefined : runtime.getPartId(slot);
    const part =
      partId === undefined ? undefined : this.options.sceneController.scene.parts.get(partId);
    if (slot === undefined || partId === undefined || part === undefined) {
      throw new UnknownSceneIdentityError("partOccurrence", partOccurrenceId);
    }
    return { slot, partId, semantic: getPartSemanticIndex(part) };
  }

  private applyChanged(changed: readonly PartId[]): void {
    if (changed.length === 0) return;
    this.options.navigationBoundsCache.invalidate();
    if (this.options.isBatching()) {
      for (const partId of changed) this.pendingVisibility.add(partId);
    } else {
      this.options.renderer.updateVisibility(this.options.sceneController.runtime, changed);
    }
    this.options.invalidate();
  }
}

interface ResolvedPrimitive {
  readonly slot: number;
  readonly partId: PartId;
  readonly semantic: PartSemanticIndex;
}
