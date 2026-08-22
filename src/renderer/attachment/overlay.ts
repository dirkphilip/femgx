import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import { rebuildEdgeOrders, rebuildTransparentOrders } from "./orders";
import { writeNodeOrders, type SelectionState } from "../selection-state";
import type { InstanceLayout } from "../runtime-state";
import type { DrawResources } from "../resources/draw-resources";
import type { GpuBundle } from "../recovery";

interface OverlayOrderOptions {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly parts: ReadonlySet<PartId>;
  readonly edgeFlags: readonly boolean[];
  readonly edgeEmphasisFlags: readonly boolean[];
  readonly attachedParts: ReadonlyMap<PartId, Part>;
  readonly selection: SelectionState;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly edgesVisible?: boolean;
  readonly nodesVisible?: boolean;
  readonly force?: boolean;
}

/** Rebuilds the renderer-owned edge and node overlays for affected parts. */
export function rebuildOverlayOrders(options: OverlayOrderOptions): boolean {
  if (options.force === true || options.edgesVisible !== undefined) {
    rebuildEdgeOrders({
      runtime: options.runtime,
      layout: options.layout,
      parts: options.parts,
      flags: options.edgeFlags,
      emphasisFlags: options.edgeEmphasisFlags,
      ...(options.edgesVisible === undefined ? {} : { visible: options.edgesVisible }),
      draw: options.bundle.draw,
    });
  }
  if (options.force === true || options.nodesVisible !== undefined) {
    writeNodeOrders(
      {
        runtime: options.runtime,
        layout: options.layout,
        parts: options.attachedParts,
        selection: options.selection,
        bundle: options.bundle,
        interaction: options.interaction,
        ...(options.nodesVisible === undefined ? {} : { visible: options.nodesVisible }),
      },
      options.parts,
    );
  }
  return (
    options.force === true ||
    options.edgesVisible !== undefined ||
    options.nodesVisible !== undefined
  );
}

/** Returns reusable parts touched by changed runtime instance slots. */
export function changedInstanceParts(
  runtime: PackedSceneRuntime,
  changedInstanceIds: readonly number[],
): ReadonlySet<PartId> {
  const parts = new Set<PartId>();
  for (const slot of changedInstanceIds) {
    const partId =
      slot < 0 || slot >= runtime.instanceCount ? undefined : runtime.instancePartIds[slot];
    if (partId !== undefined) parts.add(partId);
  }
  return parts;
}

/** Rebuilds style-dependent orders after instance interaction changes. */
export function rebuildChangedStyleOrders(options: {
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly transparentChanged: ReadonlySet<PartId>;
  readonly transparentFlags: readonly boolean[];
  readonly draw: DrawResources;
}): boolean {
  if (options.transparentChanged.size > 0) {
    rebuildTransparentOrders(
      options.runtime,
      options.layout,
      options.transparentChanged,
      options.transparentFlags,
      options.draw,
    );
  }
  return options.transparentChanged.size > 0;
}
