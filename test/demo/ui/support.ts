import { tick, mount, unmount } from "svelte";
import { createInteractionState } from "@/entries/interaction";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createResultsPreset } from "../../../demo/fixtures/results-preset";
import { createExampleModel } from "../../../demo/workbench/models/model";
import type {
  WorkbenchCommands,
  WorkbenchPresentationPort,
  WorkbenchSnapshot,
  WorkbenchSnapshotInput,
} from "../../../demo/workbench/presentation/snapshot";
import { createWorkbenchSnapshot } from "../../../demo/workbench/presentation/snapshot-builder";
import type { WorkbenchElementDetailSnapshot } from "../../../demo/workbench/state/show-state";
import type { WorkbenchVisibilityRowSnapshot } from "../../../demo/workbench/state/visibility-snapshot";
import type { VisibilityRowTarget } from "../../../demo/workbench/state/visibility-snapshot";
import { DEFORMATION_OFF_VALUE } from "../../../demo/workbench/results/result-controls";
import BuildInfo from "../../../demo/workbench/ui/BuildInfo.svelte";
import ResultLegend from "../../../demo/workbench/ui/ResultLegend.svelte";
import StatusOverlays from "../../../demo/workbench/ui/StatusOverlays.svelte";
import ViewportPane from "../../../demo/workbench/ui/ViewportPane.svelte";
import ViewportWorkspace from "../../../demo/workbench/ui/ViewportWorkspace.svelte";
import PrimaryToolbar from "../../../demo/workbench/ui/PrimaryToolbar.svelte";
import ModelSource from "../../../demo/workbench/ui/ModelSource.svelte";
import ContextMenu from "../../../demo/workbench/ui/ContextMenu.svelte";
import VisibilityTree from "../../../demo/workbench/ui/VisibilityTree.svelte";
import ElementDetail from "../../../demo/workbench/ui/ElementDetail.svelte";
import WorkbenchApp from "../../../demo/workbench/ui/WorkbenchApp.svelte";
import AnalysisControls from "../../../demo/workbench/ui/AnalysisControls.svelte";
import TouchToolRail from "../../../demo/workbench/ui/TouchToolRail.svelte";
import LivePartDialog from "../../../demo/workbench/ui/LivePartDialog.svelte";

const VECTOR_OFF = "__vectors_off__";

/** Dispatches a select change through the mounted Svelte control. */
async function change(target: HTMLElement, selector: string, value: string): Promise<void> {
  const control = element(target, selector) as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
}

/** Dispatches input and change events through a mounted numeric control. */
async function input(target: HTMLElement, selector: string, value: string): Promise<void> {
  const control = element(target, selector) as HTMLInputElement;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
}

/** Finds a mounted button by selector. */
function button(target: HTMLElement, selector: string): HTMLButtonElement {
  return element(target, selector) as HTMLButtonElement;
}

/** Finds a mounted element by selector and fails with its selector. */
function element(target: HTMLElement, selector: string): HTMLElement {
  const value = target.querySelector<HTMLElement>(selector);
  if (value === null) throw new Error(`Missing ${selector}`);
  return value;
}

/** Creates a command-recording presentation port for component tests. */
function fakeController(calls: string[]): WorkbenchPresentationPort {
  return controllerWithCommands(calls);
}

/** Wraps command recording in the presentation-port shape required by the UI. */
function controllerWithCommands(calls: string[]): WorkbenchPresentationPort {
  return {
    commands: createCommands(calls),
    elementDetails: {
      elementIdsForDetail: () => [],
      isElementSelected: () => false,
    },
    subscribe: () => () => undefined,
  };
}

/** Creates a presentation port that immediately publishes a chosen snapshot. */
function connectableController(
  snapshot: WorkbenchSnapshot,
  calls: string[],
  commands: WorkbenchCommands = createCommands(calls),
): WorkbenchPresentationPort {
  return {
    commands,
    elementDetails: {
      elementIdsForDetail: () => [],
      isElementSelected: () => false,
    },
    subscribe: (listener: (current: WorkbenchSnapshot) => void) => {
      listener(snapshot);
      return () => calls.push("unsubscribe");
    },
  };
}

/** Creates typed command spies without duplicating the command surface. */
function createCommands(calls: string[]): WorkbenchCommands {
  return new Proxy({} as WorkbenchCommands, {
    get:
      (_target, property: string) =>
      (..._args: readonly unknown[]) => {
        calls.push(property);
      },
  });
}

/** Builds the smallest realistic workbench snapshot for component tests. */
function createSnapshot(
  withResults: boolean,
  playback?: WorkbenchSnapshot["analysis"]["playback"],
): WorkbenchSnapshot {
  const preset = withResults ? createResultsPreset() : createBoltedPlatePreset();
  const model = createExampleModel(preset);
  const input: WorkbenchSnapshotInput = {
    model,
    models: [model],
    catalogMode: "ordinary",
    catalogSelectionId: model.id,
    runtime: createSceneOccurrenceSnapshot(model.scene),
    interaction: createInteractionState(),
    rendererName: "webgpu",
    rendererState: "",
    cameraMode: "perspective",
    background: "studio",
    toggles: { edges: true, nodes: true, diagnostics: false },
    continuous: false,
    selectionGranularity: "element",
    boxSelectionStrategy: "through-intersection",
    touchInteractionMode: "navigate",
    activeSlot: "primary",
    secondaryOpen: false,
    secondaryBusy: false,
    scalarFieldId: withResults ? "demo-stress" : "__base__",
    resultMode: withResults ? "deformed" : "base",
    deformationScale: 1,
    vectorDisplay: {
      fieldId: withResults ? "demo-normals" : VECTOR_OFF,
      glyph: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 2,
    },
    sectionAxis: "off",
    sectionOffset: 0,
    ...(playback === undefined ? {} : { resultPlayback: playback }),
  };
  return createWorkbenchSnapshot(input);
}

/** Builds a compact assembly/body visibility tree fixture. */
function visibilitySnapshot(): WorkbenchSnapshot["hierarchy"]["visibility"] {
  const assembly: WorkbenchVisibilityRowSnapshot = {
    key: "assembly:1",
    target: { kind: "assembly", occurrenceId: "1" },
    kind: "assembly",
    depth: 1,
    label: "Root",
    badge: "AssemblyDefinition",
    ariaLabel: undefined,
    testId: "assembly-occurrence-vis-1",
    checked: true,
    disabled: false,
    expanded: false,
    expandable: true,
    highlighted: false,
    hidden: false,
    position: 1,
    setSize: 1,
  };
  const bodyTarget: VisibilityRowTarget = { kind: "body", partOccurrenceId: "1", bodyId: 1 };
  const body: WorkbenchVisibilityRowSnapshot = {
    key: "body:1:1",
    target: bodyTarget,
    kind: "body",
    depth: 2,
    label: "Body",
    badge: "Body",
    ariaLabel: "Body in Root · Part",
    testId: "body-vis-1-1",
    checked: true,
    disabled: false,
    expanded: false,
    expandable: false,
    highlighted: false,
    elementCount: 2,
    hidden: false,
    position: 1,
    setSize: 1,
  };
  return {
    context: "AssemblyDefinition · Root",
    rows: [assembly, body],
    page: 0,
    pageCount: 1,
    rowCount: 2,
    materializedRowCount: 2,
  };
}

/** Enables the overlay state needed by workspace and status assertions. */
function withOverlayState(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  return {
    ...snapshot,
    toolbar: { ...snapshot.toolbar, secondaryOpen: true },
    overlays: {
      ...snapshot.overlays,
      rendererStatusVisible: true,
      statusVisible: true,
      inspection: { visible: true, text: "Element 1" },
      diagnostics: true,
      diagnosticsText: "draw calls: 1",
      resultLegend: {
        visible: true,
        scalar: {
          field: { id: "demo-stress", name: "Demo stress", location: "elemental", unit: "MPa" },
          range: { min: 10, max: 80 },
          palette: [
            { offset: 0, color: { r: 0.1, g: 0.2, b: 0.9, a: 1 } },
            { offset: 1, color: { r: 0.9, g: 0.1, b: 0.1, a: 1 } },
          ],
          missingColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
          thresholds: undefined,
        },
        deformation: undefined,
        orientation: undefined,
        section: { axis: "off", offset: 0 },
      },
      contextMenu: {
        visible: true,
        x: 10,
        y: 20,
        title: "Element 1",
        entries: [{ kind: "button", label: "Highlight", action: "highlight" }],
      },
    },
  };
}

export {
  tick,
  mount,
  unmount,
  createInteractionState,
  createSceneOccurrenceSnapshot,
  createBoltedPlatePreset,
  createResultsPreset,
  createExampleModel,
  DEFORMATION_OFF_VALUE,
  BuildInfo,
  ResultLegend,
  StatusOverlays,
  ViewportPane,
  ViewportWorkspace,
  PrimaryToolbar,
  ModelSource,
  ContextMenu,
  VisibilityTree,
  ElementDetail,
  WorkbenchApp,
  AnalysisControls,
  TouchToolRail,
  LivePartDialog,
  change,
  input,
  button,
  element,
  fakeController,
  controllerWithCommands,
  connectableController,
  createCommands,
  createSnapshot,
  visibilitySnapshot,
  withOverlayState,
};
export type {
  WorkbenchCommands,
  WorkbenchElementDetailSnapshot,
  WorkbenchPresentationPort,
  WorkbenchSnapshot,
  WorkbenchSnapshotInput,
  WorkbenchVisibilityRowSnapshot,
  VisibilityRowTarget,
};
