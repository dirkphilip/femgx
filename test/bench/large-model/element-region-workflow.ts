import {
  createInteractionState,
  installViewportInteraction,
  selectedElementRegion,
} from "@/entries/interaction";
import type {
  BoxSelectionRect,
  ElementRegionSelection,
  ViewportInteractionApplyRequest,
  ViewportInteractionOptions,
} from "@/entries/interaction";
import type { InteractionGranularity, Scene, Viewport } from "@/entries/root";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle, destroyGpuBundle } from "@/renderer/recovery";
import {
  viewportInteractionProbeKey,
  type ViewportInteractionProbe,
} from "@/interaction/viewport-interaction-types";
import {
  throughIntersectionBoxSelectionResolver,
  type ThroughBoxSelectionProbe,
} from "../../../demo/workbench/selection/through-box-selection";
import { fakeGpuDevice } from "../../renderer/fake-gpu";
import { pointer, settle, viewportHarness } from "../../interaction/viewport-interaction-support";
import type { AsyncOperationSpec } from "../operation-report";

const BROAD_RECT: BoxSelectionRect = {
  left: 0,
  top: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
};

export interface ThroughWorkflowRunner {
  readonly operation: AsyncOperationSpec;
  readonly details: Readonly<Record<string, number>>;
  run(): Promise<void>;
  selection(): ElementRegionSelection;
  reset(): void;
  clear(): void;
  dispose(): void;
}

/** Measures the canonical Through host handoff through one renderer synchronization. */
export async function createThroughWorkflowRunner(
  occurrenceCount: number,
  scene: Scene,
  viewport: () => Viewport,
  assertSelection: (selection: ElementRegionSelection, occurrenceCount: number) => void,
): Promise<ThroughWorkflowRunner> {
  const lifecycleProbe = emptyLifecycleProbe();
  const throughProbe = emptyThroughProbe();
  const runtime = createPackedSceneRuntime(scene);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = attachRenderer(scene, runtime, bundle);
  const resolver = throughIntersectionBoxSelectionResolver(viewport, throughProbe);
  return createRunner({
    scene,
    runtime,
    bundle,
    attachment,
    resolver,
    lifecycleProbe,
    throughProbe,
    occurrenceCount,
    assertSelection,
  });
}

function attachRenderer(
  scene: Scene,
  runtime: ReturnType<typeof createPackedSceneRuntime>,
  bundle: Awaited<ReturnType<typeof createGpuBundle>>,
): RendererAttachment {
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  return attachment;
}

interface RunnerOptions {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
  readonly attachment: RendererAttachment;
  readonly resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>;
  readonly lifecycleProbe: ViewportInteractionProbe;
  readonly throughProbe: ThroughBoxSelectionProbe;
  readonly occurrenceCount: number;
  readonly assertSelection: (selection: ElementRegionSelection, occurrenceCount: number) => void;
}

function createRunner(options: RunnerOptions): ThroughWorkflowRunner {
  const interaction = { current: createInteractionState() };
  let latest: ElementRegionSelection | undefined;
  const details: Record<string, number> = {};
  let rendererSynchronizations = 0;
  let requestedRenders = 0;
  let rendererSynchronizationMilliseconds = 0;
  const reset = (): void => {
    resetValues(options.lifecycleProbe);
    resetValues(options.throughProbe);
    interaction.current = createInteractionState();
    options.attachment.updateElements(
      options.runtime,
      interaction.current,
      options.bundle,
      options.scene.parts,
    );
    rendererSynchronizations = 0;
    requestedRenders = 0;
    rendererSynchronizationMilliseconds = 0;
  };
  const run = async (): Promise<void> => {
    const result = await runWorkflow({
      ...options,
      interaction,
      onInteraction: () => {
        rendererSynchronizations += 1;
        requestedRenders += 1;
      },
      onSynchronized: (milliseconds) => {
        rendererSynchronizationMilliseconds += milliseconds;
      },
    });
    latest = result.selection;
    options.assertSelection(latest, options.occurrenceCount);
    Object.assign(details, options.lifecycleProbe, options.throughProbe, result.lifecycleDetails, {
      rendererSynchronizations,
      requestedRenders,
      rendererSynchronizationMilliseconds,
      selectedIdentities: latest.count,
      occurrenceGroups: latest.partOccurrenceIds.length,
      queryOutputTypedBytes: latest.elementIds.byteLength + latest.offsets.byteLength,
    });
  };
  return workflowRunner({
    options,
    details,
    run,
    selection: () => latest,
    clear: () => {
      latest = undefined;
    },
    reset,
  });
}

function workflowRunner(options: {
  readonly options: RunnerOptions;
  readonly details: Record<string, number>;
  readonly run: () => Promise<void>;
  readonly selection: () => ElementRegionSelection | undefined;
  readonly clear: () => void;
  readonly reset: () => void;
}): ThroughWorkflowRunner {
  const { details, run, reset } = options;
  return {
    operation: {
      name: "through-element-region-host-default-renderer-workflow",
      workloadUnit: "selected authored element occurrences",
      workloadCount: options.options.occurrenceCount * 250_632,
      workloadDetails: details,
      beforeEach: reset,
      run,
    },
    details,
    run,
    selection: () => requireSelection(options.selection()),
    reset,
    clear: options.clear,
    dispose: () => {
      destroyGpuBundle(options.options.bundle);
    },
  };
}

async function runWorkflow(options: {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
  readonly attachment: RendererAttachment;
  readonly resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>;
  readonly lifecycleProbe: ViewportInteractionProbe;
  readonly throughProbe: ThroughBoxSelectionProbe;
  readonly interaction: { current: ReturnType<typeof createInteractionState> };
  readonly onInteraction: () => void;
  readonly onSynchronized: (milliseconds: number) => void;
}): Promise<{
  readonly selection: ElementRegionSelection;
  readonly lifecycleDetails: Record<string, number>;
}> {
  const harness = viewportHarness();
  Object.assign(harness.canvas, { dataset: {} });
  const viewport = hostViewport(harness, options.interaction);
  let applyCallbacks = 0;
  const interactionOptions = {
    canvas: harness.canvas as unknown as HTMLCanvasElement,
    viewport,
    granularity: () => "element" as const,
    resolveRegion: () => options.resolver({ event: boxEvent(), granularity: "element" }),
    [viewportInteractionProbeKey]: options.lifecycleProbe,
    applyInteraction: (request) => {
      if (request.phase !== "box" || request.granularity !== "element") {
        throw new Error("Expected packed box apply request");
      }
      applyCallbacks += 1;
      applyHostDefault(options, request);
      return request.defaultInteraction;
    },
  } satisfies ViewportInteractionOptions & {
    readonly [viewportInteractionProbeKey]: ViewportInteractionProbe;
  };
  const disposer = installViewportInteraction(interactionOptions);
  harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
  harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
  await settle();
  disposer();
  return {
    selection: selectedElementRegion(options.interaction.current),
    lifecycleDetails: { applyCallbacks },
  };
}

function hostViewport(
  harness: ReturnType<typeof viewportHarness>,
  interaction: { current: ReturnType<typeof createInteractionState> },
): ViewportInteractionOptions["viewport"] {
  return {
    view: harness.viewport.view,
    interaction: {
      get state() {
        return interaction.current;
      },
      pick: (x: number, y: number, granularity?: "edge") =>
        harness.viewport.interaction.pick(x, y, granularity),
      pickRegion: (rect: BoxSelectionRect, granularity: InteractionGranularity) =>
        harness.viewport.interaction.pickRegion(rect, granularity),
      set: (next) => {
        interaction.current = next;
      },
    },
  };
}

function applyHostDefault(
  options: Parameters<typeof runWorkflow>[0],
  request: ViewportInteractionApplyRequest,
): void {
  if (request.current !== options.interaction.current) {
    throw new Error("Box default was not derived from host state");
  }
  const started = performance.now();
  options.attachment.updateElements(
    options.runtime,
    request.defaultInteraction,
    options.bundle,
    options.scene.parts,
  );
  options.onSynchronized(performance.now() - started);
  options.interaction.current = request.defaultInteraction;
  options.onInteraction();
}

function requireSelection(value: ElementRegionSelection | undefined): ElementRegionSelection {
  if (value === undefined) throw new Error("Element workflow has not produced a selection");
  return value;
}

function boxEvent() {
  return {
    type: "complete" as const,
    anchor: { x: 0, y: 0 },
    current: { x: 800, y: 600 },
    rect: BROAD_RECT,
    modifiers: { shift: false, control: false, alt: false, meta: false },
  };
}

function emptyThroughProbe(): ThroughBoxSelectionProbe {
  return {
    occurrencesVisited: 0,
    elementsVisited: 0,
    intersectionTests: 0,
    selectedIdentities: 0,
    groupsCreated: 0,
    typedScratchGrowths: 0,
    typedScratchBytes: 0,
    outputTypedBytes: 0,
    queryMilliseconds: 0,
    packPublishMilliseconds: 0,
  };
}

function emptyLifecycleProbe(): ViewportInteractionProbe {
  return {
    descriptorVisits: 0,
    targetKeyStrings: 0,
    defaultElementTransitions: 0,
    defaultElementTransitionMilliseconds: 0,
    callbackSelectionCopies: 0,
    statePublications: 0,
  };
}

function resetValues(values: object): void {
  for (const key of Object.keys(values)) (values as Record<string, number>)[key] = 0;
}
