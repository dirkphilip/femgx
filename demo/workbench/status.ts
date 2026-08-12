import type { PartId } from "../../src/index";
import type { ModelPreset } from "../fixture/presets";
import type { DisplayToggles, RendererStats, WorkbenchSceneContext } from "./types";

/** Display inputs used to format one status snapshot. */
export interface StatusTextOptions {
  readonly rendererName: string;
  readonly toggles: DisplayToggles;
  readonly stats: RendererStats;
  readonly selectedCount: number;
}

/** Formats the diagnostics block for the current scene/runtime snapshot. */
export function statsText(context: WorkbenchSceneContext, options: StatusTextOptions): string {
  const partLines: string[] = [];
  const firstInstances = new Map<PartId, { readonly visible: boolean }>();
  for (const instance of context.runtime.getInstances()) {
    if (!firstInstances.has(instance.partId)) {
      firstInstances.set(instance.partId, instance);
    }
  }
  for (const partId of sortedNumbers(firstInstances.keys())) {
    const visible = firstInstances.get(partId)?.visible ?? false;
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
    `Selections ${options.selectedCount}` +
    diagnostics
  );
}

/** Triangle count after runtime visibility, including every instance draw. */
export function visibleTriangleCount(context: WorkbenchSceneContext): number {
  let triangles = 0;
  for (const instance of context.runtime.getInstances()) {
    if (!instance.visible) continue;
    triangles += triangleCount(context.preset, instance.partId);
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
