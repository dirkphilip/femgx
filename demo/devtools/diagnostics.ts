import type { PartId } from "../../src/entries/root";
import type {
  DisplayToggles,
  RenderLoopStats,
  RendererStats,
  WorkbenchSceneContext,
} from "../workbench/types";

/** Display inputs used to format one status snapshot. */
export interface StatusTextOptions {
  readonly rendererName: string;
  readonly toggles: DisplayToggles;
  readonly stats: RendererStats;
  readonly renderLoop: RenderLoopStats;
  readonly selectedCount: number;
}

/** Formats the diagnostics block for the current scene/runtime snapshot. */
export function statsText(context: WorkbenchSceneContext, options: StatusTextOptions): string {
  const details = options.toggles.diagnostics
    ? [...benchmarkLines(context), ...partLines(context), ...issueLines(context)]
    : [];
  const diagnostics = options.toggles.diagnostics ? `\n\n${details.join("\n")}` : "";
  return (
    `Model ${context.model.name} (${context.model.id})\n` +
    `Renderer ${options.rendererName}\n` +
    `Visible instances ${options.stats.visibleInstances}\n` +
    `Unique triangles ${formatCount(uniqueTriangleCount(context))}\n` +
    `Submitted triangles ${formatCount(submittedTriangleCount(context))}\n` +
    `Reusable parts ${context.model.scene.parts.size}\n` +
    `Draw batches ${options.stats.batches}\n` +
    `Selections ${options.selectedCount}\n` +
    renderLoopLines(options.renderLoop) +
    diagnostics
  );
}

function benchmarkLines(context: WorkbenchSceneContext): string[] {
  const family = context.model.benchmarkElementFamily;
  return family === undefined
    ? []
    : [
        `Element family ${family}`,
        `Unique elements ${formatCount(uniqueElementCount(context))}`,
        `Submitted element occurrences ${formatCount(submittedElementOccurrences(context))}`,
      ];
}

function renderLoopLines(stats: RenderLoopStats): string {
  return (
    `Render loop ${stats.state}\n` +
    `Sample duration ${formatMilliseconds(stats.sampleDurationMs)}\n` +
    `Sample frames ${stats.sampleFrameCount}\n` +
    `Average FPS ${formatRate(stats.averageFps)}\n` +
    `p50 frame interval ${formatOptionalMilliseconds(stats.p50FrameIntervalMs)}\n` +
    `p95 frame interval ${formatOptionalMilliseconds(stats.p95FrameIntervalMs)}\n` +
    `Longest frame interval ${formatOptionalMilliseconds(stats.longestFrameIntervalMs)}\n` +
    "Note: RAF FPS is refresh-rate-limited render-loop behavior, not queue-drained GPU time."
  );
}

function partLines(context: WorkbenchSceneContext): string[] {
  const lines: string[] = [];
  const firstInstances = new Map<PartId, { readonly visible: boolean }>();
  for (const instance of context.runtime.getInstances()) {
    if (!firstInstances.has(instance.partId)) firstInstances.set(instance.partId, instance);
  }
  for (const partId of sortedNumbers(firstInstances.keys())) {
    const visible = firstInstances.get(partId)?.visible ?? false;
    lines.push(
      `Part ${partId} ${context.model.partNames.get(partId) ?? ""} · ${visible ? "shown" : "hidden"}`,
    );
  }
  return lines;
}

function issueLines(context: WorkbenchSceneContext): string[] {
  return context.model.issues.map(
    (issue) => `Import ${issue.severity} · ${issue.code}: ${issue.message}`,
  );
}

/** Triangle count in the reusable part definitions, independent of placement count. */
function uniqueTriangleCount(context: WorkbenchSceneContext): number {
  let triangles = 0;
  for (const part of context.model.scene.parts.values())
    triangles += part.geometries.reduce(
      (total, geometry) =>
        total + (geometry.primitive === "triangles" ? Math.floor(geometry.indices.length / 3) : 0),
      0,
    );
  return triangles;
}

/** Triangle count after runtime visibility, including every visible instance draw. */
function submittedTriangleCount(context: WorkbenchSceneContext): number {
  let triangles = 0;
  for (const instance of context.runtime.getInstances()) {
    if (!instance.visible) continue;
    triangles += triangleCount(context.model, instance.partId);
  }
  return triangles;
}

function uniqueElementCount(context: WorkbenchSceneContext): number {
  let elements = 0;
  for (const part of context.model.scene.parts.values()) {
    elements += part.elements?.length ?? 0;
  }
  return elements;
}

function submittedElementOccurrences(context: WorkbenchSceneContext): number {
  let elements = 0;
  for (const instance of context.runtime.getInstances()) {
    elements += context.model.scene.parts.get(instance.partId)?.elements?.length ?? 0;
  }
  return elements;
}

function triangleCount(model: WorkbenchSceneContext["model"], partId: PartId | undefined): number {
  const part = partId === undefined ? undefined : model.scene.parts.get(partId);
  return part === undefined
    ? 0
    : part.geometries.reduce(
        (total, geometry) =>
          total +
          (geometry.primitive === "triangles" ? Math.floor(geometry.indices.length / 3) : 0),
        0,
      );
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(0)} ms`;
}

function formatOptionalMilliseconds(value: number | undefined): string {
  return value === undefined ? "—" : formatMilliseconds(value);
}

function formatRate(value: number): string {
  return value.toFixed(1);
}
