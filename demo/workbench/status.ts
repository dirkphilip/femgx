import type { PartId } from "../../src/index";
import type { ModelPreset } from "../fixture/presets";
import type { ElementDisplayMode } from "../fixture/types";
import type { DisplayToggles, RendererStats, WorkbenchSceneContext } from "./types";

/** Display inputs used to format one status snapshot. */
export interface StatusTextOptions {
  readonly rendererName: string;
  readonly mode: ElementDisplayMode;
  readonly toggles: DisplayToggles;
  readonly stats: RendererStats;
  readonly selectedCount: number;
}

/** Formats the diagnostics block for the current scene/runtime snapshot. */
export function statsText(context: WorkbenchSceneContext, options: StatusTextOptions): string {
  const partLines: string[] = [];
  for (const partId of sortedNumbers(context.partFirstSlot.keys())) {
    const slot = context.partFirstSlot.get(partId);
    if (slot === undefined) continue;
    const visible = context.runtime.instancePartVisible[slot] === 1;
    partLines.push(
      `Part ${partId} ${context.preset.partNames.get(partId) ?? ""} · ${visible ? "shown" : "hidden"}`,
    );
  }
  const diagnostics = options.toggles.diagnostics ? `\n\n${partLines.join("\n")}` : "";
  return (
    `Model ${context.preset.name} (${context.preset.id})\n` +
    `Renderer ${options.rendererName}\n` +
    `Visible instances ${options.stats.visibleInstances}\n` +
    `Visible triangles ${formatCount(visibleTriangleCount(context))}\n` +
    `Reusable parts ${context.preset.scene.parts.size}\n` +
    `Draw batches ${options.stats.batches}\n` +
    `Mode ${options.mode}\n` +
    `Selections ${options.selectedCount}` +
    diagnostics
  );
}

/** Triangle count after runtime visibility, including every instance draw. */
export function visibleTriangleCount(context: WorkbenchSceneContext): number {
  let triangles = 0;
  for (let slot = 0; slot < context.runtime.instanceCount; slot++) {
    if (!context.runtime.isInstanceVisible(slot)) continue;
    triangles += triangleCount(context.preset, context.runtime.instancePartIds[slot]);
  }
  return triangles;
}

/** Unique triangles stored across the preset's reusable part definitions. */
export function uniqueTriangleCount(preset: ModelPreset): number {
  let triangles = 0;
  for (const part of preset.scene.parts.values())
    triangles += Math.floor(part.geometry.indices.length / 3);
  return triangles;
}

/** Submitted triangles authored by the preset before visibility changes. */
export function submittedTriangleCount(
  preset: ModelPreset,
  runtime: WorkbenchSceneContext["runtime"],
): number {
  let triangles = 0;
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    triangles += triangleCount(preset, runtime.instancePartIds[slot]);
  }
  return triangles;
}

function triangleCount(preset: ModelPreset, partId: PartId | undefined): number {
  const part = partId === undefined ? undefined : preset.scene.parts.get(partId);
  return part === undefined ? 0 : Math.floor(part.geometry.indices.length / 3);
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
