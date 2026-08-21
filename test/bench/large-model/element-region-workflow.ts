import {
  createInteractionState,
  installViewportInteraction,
  selectedElementRegion,
} from "@/entries/interaction";
import type {
  BoxSelectionRect,
  ElementRegionSelection,
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
import { WorkbenchInteraction } from "../../../demo/workbench/interaction/interaction";
import type { WorkbenchMenu } from "../../../demo/workbench/interaction/menu";
import { fakeGpuDevice } from "../../renderer/fake-gpu";
import { pointer, settle, viewportHarness } from "../../interaction/viewport-interaction-support";
import type { AsyncOperationSpec } from "../operation-report";

export interface ThroughWorkflowRunner {
  readonly operation: AsyncOperationSpec;
  readonly details: Readonly<Record<string, number>>;
  run(): Promise<void>;
  selection(): ElementRegionSelection;
  reset(): void;
  clear(): void;
  dispose(): void;
}

export interface ThroughWorkflowConfiguration {
  readonly workloadCount?: number;
  readonly configure?: (context: {
    readonly viewport: Viewport;
    readonly interaction: {
      host: ReturnType<typeof createInteractionState>;
      viewport: ReturnType<typeof createInteractionState>;
    };
  }) => void;
}

/** Measures the canonical Through host handoff through one renderer synchronization. */
export async function createThroughWorkflowRunner(
  occurrenceCount: number,
  scene: Scene,
  viewport: () => Viewport,
  assertSelection: (selection: ElementRegionSelection, occurrenceCount: number) => void,
  configuration: ThroughWorkflowConfiguration = {},
): Promise<ThroughWorkflowRunner> {
  const lifecycleProbe = emptyLifecycleProbe();
  const throughProbe = emptyThroughProbe();
  const runtime = createPackedSceneRuntime(scene);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = attachRenderer(scene, runtime, bundle);
  return createRunner({
    scene,
    runtime,
    bundle,
    attachment,
    sourceViewport: viewport,
    lifecycleProbe,
    throughProbe,
    occurrenceCount,
    assertSelection,
    workloadCount: configuration.workloadCount ?? occurrenceCount * 250_632,
    configure: configuration.configure,
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
  readonly sourceViewport: () => Viewport;
  readonly lifecycleProbe: ViewportInteractionProbe;
  readonly throughProbe: ThroughBoxSelectionProbe;
  readonly occurrenceCount: number;
  readonly assertSelection: (selection: ElementRegionSelection, occurrenceCount: number) => void;
  readonly workloadCount: number;
  readonly configure: ThroughWorkflowConfiguration["configure"];
}

function createRunner(options: RunnerOptions): ThroughWorkflowRunner {
  const initialInteraction = createInteractionState();
  const interaction = { host: initialInteraction, viewport: initialInteraction };
  let latest: ElementRegionSelection | undefined;
  const details: Record<string, number> = {};
  const reset = (): void => {
    resetValues(options.lifecycleProbe);
    resetValues(options.throughProbe);
    const emptyInteraction = createInteractionState();
    interaction.host = emptyInteraction;
    interaction.viewport = emptyInteraction;
    options.attachment.updateElements(
      options.runtime,
      interaction.host,
      options.bundle,
      options.scene.parts,
    );
  };
  const run = async (): Promise<void> => {
    const result = await runWorkflow({
      ...options,
      interaction,
    });
    latest = result.selection;
    options.assertSelection(latest, options.occurrenceCount);
    Object.assign(details, options.lifecycleProbe, options.throughProbe, result.lifecycleDetails, {
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
      workloadCount: options.options.workloadCount,
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

interface WorkflowInteraction {
  host: ReturnType<typeof createInteractionState>;
  viewport: ReturnType<typeof createInteractionState>;
}

interface WorkflowRunOptions {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly bundle: Awaited<ReturnType<typeof createGpuBundle>>;
  readonly attachment: RendererAttachment;
  readonly sourceViewport: () => Viewport;
  readonly lifecycleProbe: ViewportInteractionProbe;
  readonly throughProbe: ThroughBoxSelectionProbe;
  readonly interaction: WorkflowInteraction;
  readonly configure: ThroughWorkflowConfiguration["configure"];
}

interface WorkflowCounters {
  applyCallbacks: number;
  hostStatePublications: number;
  rendererSynchronizations: number;
  requestedRenders: number;
  rendererSynchronizationMilliseconds: number;
}

async function runWorkflow(options: WorkflowRunOptions): Promise<{
  readonly selection: ElementRegionSelection;
  readonly lifecycleDetails: Record<string, number>;
}> {
  const harness = viewportHarness();
  Object.assign(harness.canvas, {
    dataset: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect,
  });
  const counters = emptyWorkflowCounters();
  const viewport = workflowViewport(options.sourceViewport(), harness, options.interaction);
  options.configure?.({ viewport, interaction: options.interaction });
  const binding = createWorkflowBinding(options, harness, viewport, counters);
  await dispatchWorkflowBox(options, harness, viewport, binding, counters);
  return {
    selection: selectedElementRegion(options.interaction.host),
    lifecycleDetails: { ...counters },
  };
}

function createWorkflowBinding(
  options: WorkflowRunOptions,
  harness: ReturnType<typeof viewportHarness>,
  viewport: Viewport,
  counters: WorkflowCounters,
): ReturnType<WorkbenchInteraction["viewportInteractionOptions"]> {
  const resolver = throughIntersectionBoxSelectionResolver(() => viewport, options.throughProbe);
  const workbench = new WorkbenchInteraction({
    canvas: harness.canvas as unknown as HTMLCanvasElement,
    viewport: () => viewport,
    getInteraction: () => options.interaction.host,
    setInteraction: (next) => {
      options.interaction.host = next;
      counters.hostStatePublications += 1;
    },
    partName: () => undefined,
    menu: { hide: () => undefined } as WorkbenchMenu,
    render: () => {
      counters.requestedRenders += 1;
      const started = performance.now();
      options.attachment.updateElements(
        options.runtime,
        options.interaction.host,
        options.bundle,
        options.scene.parts,
      );
      counters.rendererSynchronizationMilliseconds += performance.now() - started;
      counters.rendererSynchronizations += 1;
    },
    selectionGranularity: () => "element",
    setInspection: () => undefined,
  });
  workbench.setBoxSelectionResolver(resolver);
  const binding = workbench.viewportInteractionOptions();
  if (binding.resolveRegion === undefined) throw new Error("Expected workbench region binding");
  return binding;
}

async function dispatchWorkflowBox(
  options: WorkflowRunOptions,
  harness: ReturnType<typeof viewportHarness>,
  viewport: Viewport,
  binding: ReturnType<WorkbenchInteraction["viewportInteractionOptions"]>,
  counters: WorkflowCounters,
): Promise<void> {
  if (binding.resolveRegion === undefined) throw new Error("Expected workbench region binding");
  const interactionOptions = {
    canvas: harness.canvas as unknown as HTMLCanvasElement,
    viewport,
    granularity: () => "element" as const,
    resolveRegion: binding.resolveRegion,
    [viewportInteractionProbeKey]: options.lifecycleProbe,
    applyInteraction: (request) => {
      if (request.phase !== "box" || request.granularity !== "element") {
        throw new Error("Expected packed box apply request");
      }
      counters.applyCallbacks += 1;
      return binding.applyInteraction?.(request);
    },
  } satisfies ViewportInteractionOptions & {
    readonly [viewportInteractionProbeKey]: ViewportInteractionProbe;
  };
  const disposer = installViewportInteraction(interactionOptions);
  harness.canvas.dispatch("pointerdown", pointer({ clientX: 0, clientY: 0, buttons: 1 }));
  harness.canvas.dispatch("pointermove", pointer({ clientX: 800, clientY: 600, buttons: 1 }));
  harness.canvas.dispatch("pointerup", pointer({ clientX: 800, clientY: 600 }));
  await settle();
  disposer();
}

function emptyWorkflowCounters(): WorkflowCounters {
  return {
    applyCallbacks: 0,
    hostStatePublications: 0,
    rendererSynchronizations: 0,
    requestedRenders: 0,
    rendererSynchronizationMilliseconds: 0,
  };
}

function workflowViewport(
  source: Viewport,
  harness: ReturnType<typeof viewportHarness>,
  interaction: WorkflowInteraction,
): Viewport {
  return {
    ...source,
    interaction: {
      get state() {
        return interaction.viewport;
      },
      pick: (x: number, y: number, granularity?: "edge") =>
        harness.viewport.interaction.pick(x, y, granularity),
      pickRegion: (rect: BoxSelectionRect, granularity: InteractionGranularity) =>
        harness.viewport.interaction.pickRegion(rect, granularity),
      set: (next) => {
        interaction.viewport = next;
      },
    },
  } as Viewport;
}

function requireSelection(value: ElementRegionSelection | undefined): ElementRegionSelection {
  if (value === undefined) throw new Error("Element workflow has not produced a selection");
  return value;
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
