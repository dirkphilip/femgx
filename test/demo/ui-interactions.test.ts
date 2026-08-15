import { tick, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { createInteractionState, createSceneRuntime } from "../../src/index";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { createResultsPreset } from "../../demo/fixture/results-preset";
import { createExampleModel } from "../../demo/workbench/model";
import type { WorkbenchController } from "../../demo/workbench/controller";
import type {
  WorkbenchCommands,
  WorkbenchElementDetailSnapshot,
  WorkbenchSnapshot,
} from "../../demo/workbench/snapshot";
import {
  createWorkbenchSnapshot,
  type WorkbenchSnapshotInput,
} from "../../demo/workbench/snapshot";
import type { WorkbenchVisibilityRowSnapshot } from "../../demo/workbench/visibility-snapshot";
import type { VisibilityRowTarget } from "../../demo/workbench/visibility-snapshot";
import { DEFORMATION_OFF_VALUE } from "../../demo/workbench/result-controls";
import BuildInfo from "../../demo/workbench/ui/BuildInfo.svelte";
import ResultLegend from "../../demo/workbench/ui/ResultLegend.svelte";
import StatusOverlays from "../../demo/workbench/ui/StatusOverlays.svelte";
import ViewportPane from "../../demo/workbench/ui/ViewportPane.svelte";
import ViewportWorkspace from "../../demo/workbench/ui/ViewportWorkspace.svelte";
import PrimaryToolbar from "../../demo/workbench/ui/PrimaryToolbar.svelte";
import ModelSource from "../../demo/workbench/ui/ModelSource.svelte";
import ContextMenu from "../../demo/workbench/ui/ContextMenu.svelte";
import VisibilityTree from "../../demo/workbench/ui/VisibilityTree.svelte";
import ElementDetail from "../../demo/workbench/ui/ElementDetail.svelte";
import WorkbenchApp from "../../demo/workbench/ui/WorkbenchApp.svelte";
import AnalysisControls from "../../demo/workbench/ui/AnalysisControls.svelte";
import TouchToolRail from "../../demo/workbench/ui/TouchToolRail.svelte";

const VECTOR_OFF = "__vectors_off__";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench Svelte controls", () => {
  it("dispatches toolbar and contextual analysis changes through typed commands", async () => {
    const calls: string[] = [];
    const controller = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller, snapshot: createSnapshot(true) },
    });
    const modelSource = mount(ModelSource, {
      target,
      props: { controller, snapshot: createSnapshot(true) },
    });

    button(target, "#command-view").click();
    await change(target, "#background-select", "dark");
    button(target, "#command-selection").click();
    await change(target, "#box-selection-strategy", "through-intersection");
    await change(target, "#selection-granularity", "face");
    await change(target, "#selection-granularity", "edge");
    await change(target, "#model-select", "results");
    button(target, "#command-analysis").click();
    await change(target, "#result-field", "demo-stress");
    await change(target, "#deformation-field", "demo-displacement");
    await change(target, "#vector-field", "demo-fibers");
    await change(target, "#vector-glyph", "axis");
    await change(target, "#vector-transform", "direction");
    await change(target, "#section-axis", "z");
    await input(target, "#deformation-scale", "2");
    await input(target, "#vector-length-scale", "1.5");
    await input(target, "#vector-width-pixels", "1.5");
    await input(target, "#section-offset", "0.5");
    button(target, "#command-selection").click();
    button(target, "#select-all").click();
    button(target, "#hide-selected").click();
    await tick();
    button(target, "#command-view").click();
    for (const selector of ["#fit-view", "#viewport-toggle", "#projection-toggle"]) {
      button(target, selector).click();
      await tick();
    }
    button(target, "#command-display").click();
    for (const selector of ["#edge-overlay", "#node-overlay", "#continuous-rendering"]) {
      button(target, selector).click();
      await tick();
    }

    expect(calls).toEqual(
      expect.arrayContaining([
        "setBackground",
        "setSelectionGranularity",
        "setBoxSelectionStrategy",
        "selectAll",
        "selectModel",
        "setResultField",
        "setDeformationField",
        "setVectorField",
        "setVectorGlyph",
        "setVectorTransform",
        "setSectionAxis",
        "setDeformationScale",
        "setVectorLengthScale",
        "setVectorWidthPixels",
        "setSectionOffset",
        "fitSelection",
        "toggleSecondaryViewport",
        "setProjection",
        "toggleEdges",
        "toggleNodes",
        "toggleContinuous",
      ]),
    );

    await unmount(modelSource);
    await unmount(component);
  });

  it("keeps the command bar compact and closes disclosures predictably", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(false) },
    });

    expect(target.querySelectorAll(".command-target")).toHaveLength(4);
    expect(element(target, "#selection-controls").hidden).toBe(true);
    button(target, "#command-selection").click();
    await tick();
    expect(element(target, "#selection-controls").hidden).toBe(false);
    expect(button(target, "#command-selection").getAttribute("aria-expanded")).toBe("true");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(element(target, "#selection-controls").hidden).toBe(true);
    expect(document.activeElement).toBe(button(target, "#command-selection"));

    button(target, "#command-view").click();
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await tick();
    expect(element(target, "#view-controls").hidden).toBe(true);

    await unmount(component);
  });

  it("routes the compact touch rail through typed tool commands", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(TouchToolRail, {
      target,
      props: { controller: fakeController(calls), snapshot: createSnapshot(false) },
    });

    button(target, '[data-testid="touch-tool-box-select"]').click();
    button(target, '[data-testid="touch-tool-navigate"]').click();
    button(target, '[data-testid="touch-tool-select-all"]').click();

    expect(calls).toEqual(["setTouchInteractionMode", "setTouchInteractionMode", "selectAll"]);
    await unmount(component);
  });

  it("keeps result controls hidden for a model without authored fields", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(false) },
    });

    const resultControls = element(target, "#result-controls");
    expect(resultControls.hidden).toBe(true);
    expect((element(target, "#section-axis") as HTMLSelectElement).value).toBe("off");
    expect(element(target, "#model-feedback").hidden).toBe(true);

    await unmount(component);
    await tick();
  });

  it("keeps dependent analysis controls out of layout until their role is active", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const base = createSnapshot(true);
    const snapshot: WorkbenchSnapshot = {
      ...base,
      analysis: {
        ...base.analysis,
        resultMode: "colored",
        deformationFieldId: DEFORMATION_OFF_VALUE,
        deformationDisabled: true,
        vectorControlsDisabled: true,
        sectionAxis: "off",
        sectionRange: undefined,
      },
    };
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot },
    });

    expect(element(target, "#result-controls").hidden).toBe(false);
    expect(element(target, "#deformation-field").closest("label")?.hidden).toBe(false);
    expect(element(target, "#deformation-scale").closest("label")?.hidden).toBe(true);
    expect(element(target, "#vector-field").closest("label")?.hidden).toBe(false);
    expect(element(target, "#vector-glyph").closest("label")?.hidden).toBe(true);
    expect(element(target, "#vector-transform").closest("label")?.hidden).toBe(true);
    expect(element(target, "#vector-length-scale").closest("label")?.hidden).toBe(true);
    expect(element(target, "#vector-width-pixels").closest("label")?.hidden).toBe(true);
    expect(element(target, "#vector-help").hidden).toBe(true);
    expect(element(target, "#section-offset").closest("label")?.hidden).toBe(true);

    await unmount(component);
    await tick();
  });

  it("routes authored result playback controls and reflects its edge states", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const playback = {
      label: "Authored load snapshots",
      range: { min: 10, max: 100 },
      index: 0,
      count: 4,
      time: 0,
      stepLabel: "Snapshot 1",
      active: true,
      playing: false,
      rate: 1,
      hasPrevious: false,
      hasNext: true,
    } as const;
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: fakeController(calls), snapshot: createSnapshot(true, playback) },
    });
    button(target, "#command-analysis").click();
    await tick();

    expect(element(target, "#result-playback-controls")).not.toBeNull();
    expect(button(target, '[data-testid="result-playback-previous"]').disabled).toBe(true);
    expect(button(target, '[data-testid="result-playback-next"]').disabled).toBe(false);
    await input(target, "#result-playback-index", "1");
    await change(target, "#result-playback-rate", "2");
    button(target, '[data-testid="result-playback-previous"]').click();
    button(target, '[data-testid="result-playback-play"]').click();
    button(target, '[data-testid="result-playback-next"]').click();
    await tick();
    expect(calls).toEqual(
      expect.arrayContaining([
        "setResultPlaybackIndex",
        "setResultPlaybackRate",
        "toggleResultPlayback",
        "nextResultPlayback",
      ]),
    );
    await unmount(component);

    const playingSnapshot = {
      ...playback,
      index: 2,
      time: 2,
      stepLabel: "Snapshot 3",
      playing: true,
      rate: 2,
      hasPrevious: true,
      hasNext: false,
    };
    const playingComponent = mount(PrimaryToolbar, {
      target,
      props: {
        controller: fakeController(calls),
        snapshot: createSnapshot(true, playingSnapshot),
      },
    });
    button(target, "#command-analysis").click();
    await tick();
    expect(button(target, '[data-testid="result-playback-previous"]').disabled).toBe(false);
    expect(button(target, '[data-testid="result-playback-next"]').disabled).toBe(true);
    expect(button(target, '[data-testid="result-playback-play"]').textContent).toContain("Pause");
    expect(
      button(target, '[data-testid="result-playback-play"]').getAttribute("aria-pressed"),
    ).toBe("true");
    button(target, '[data-testid="result-playback-previous"]').click();
    await unmount(playingComponent);
    expect(calls).toContain("previousResultPlayback");

    const emptyComponent = mount(AnalysisControls, {
      target,
      props: { controller: undefined, snapshot: undefined },
    });
    expect(element(target, "#result-controls").hidden).toBe(true);
    await unmount(emptyComponent);
  });

  it("renders conditional overlays, panes, and the root subscription lifecycle", async () => {
    const snapshot = withOverlayState(createSnapshot(true));
    const calls: string[] = [];
    const controller = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);

    const pane = mount(ViewportPane, {
      target,
      props: { secondary: true, hidden: true },
    });
    expect(element(target, "#secondary-scene").hidden).toBe(true);
    await unmount(pane);

    const workspace = mount(ViewportWorkspace, {
      target,
      props: { controller, snapshot, startup: undefined },
    });
    expect(element(target, "#viewport-workspace").dataset["secondaryOpen"]).toBe("true");
    expect(element(target, ".toolbar").closest("#viewport-shell")).not.toBeNull();
    expect(element(target, ".toolbar").closest(".scene, .scene-pane")).toBeNull();
    expect(element(target, "#viewport-workspace").parentElement?.id).toBe("viewport-stage");
    await unmount(workspace);

    const legend = mount(ResultLegend, { target, props: { snapshot } });
    expect(element(target, "#result-legend").hidden).toBe(false);
    expect(element(target, "#result-legend-scalar").textContent).toContain("Demo stress");
    expect(element(target, '[aria-label="Scalar color palette"]')).toBeDefined();
    await unmount(legend);

    const overlays = mount(StatusOverlays, { target, props: { snapshot, startup: undefined } });
    expect(element(target, "#stats-panel").hidden).toBe(false);
    await unmount(overlays);

    const buildInfo = mount(BuildInfo, { target });
    expect(element(target, "#build-info").textContent).toContain("local build");
    await unmount(buildInfo);

    const app = mount(WorkbenchApp, { target });
    const api = app as unknown as {
      connectWorkbench(next: WorkbenchController): void;
      reportStartupFailure(status: { rendererStatus: string; status: string }): void;
    };
    api.connectWorkbench(connectableController(snapshot, calls));
    api.reportStartupFailure({ rendererStatus: "Renderer unsupported", status: "Try again" });
    await tick();
    expect(element(target, "#status").textContent).toContain("Try again");
    await unmount(app);
    expect(calls).toContain("unsubscribe");
  });

  it("keeps the phone navigation drawer focusable and exclusive of Analysis", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(WorkbenchApp, { target });
    const api = app as unknown as {
      connectWorkbench(next: WorkbenchController): void;
    };
    api.connectWorkbench(
      connectableController(createSnapshot(true), [], {
        clearContextMenu: () => undefined,
      } as unknown as WorkbenchCommands),
    );
    await tick();

    const navigation = button(target, '[data-testid="navigation-toggle"]');
    expect(navigation.getAttribute("aria-expanded")).toBe("false");
    button(target, "#command-analysis").click();
    await tick();
    expect(element(target, "#analysis-controls").hidden).toBe(false);

    navigation.click();
    await tick();
    await Promise.resolve();
    expect(navigation.getAttribute("aria-expanded")).toBe("true");
    expect(element(target, "#analysis-controls").hidden).toBe(true);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
    );
    await tick();
    button(target, ".navigation-scrim").click();
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");

    navigation.click();
    await tick();
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");

    navigation.click();
    await tick();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    window.dispatchEvent(new Event("resize"));
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");

    await unmount(app);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
  });

  it("dispatches context-menu actions and closes on outside or Escape events", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const menu = mount(ContextMenu, {
      target,
      props: {
        controller: fakeController(calls),
        snapshot: withOverlayState(createSnapshot(false)),
      },
    });
    await tick();

    (element(target, '[role="menuitem"]') as HTMLButtonElement).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(calls).toEqual(expect.arrayContaining(["contextMenuAction", "clearContextMenu"]));
    await unmount(menu);
  });

  it("dispatches stable visibility targets and cleans up on unmount", async () => {
    const calls: string[] = [];
    const controller = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(VisibilityTree, {
      target,
      props: { controller, visibility: visibilitySnapshot() },
    });

    const assemblyRow = element(target, '[role="treeitem"]');
    assemblyRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    assemblyRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    button(target, ".visibility-expander").click();
    (element(target, 'input[type="checkbox"]') as HTMLInputElement).click();
    const bodyName = element(target, '[data-body-highlight="true"]') as HTMLButtonElement;
    bodyName.click();
    button(target, '[data-testid="body-elements-1-1"]').click();
    assemblyRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    assemblyRow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();

    expect(calls).toEqual(
      expect.arrayContaining([
        "setHierarchyHover",
        "clearHierarchyHover",
        "toggleVisibilityTree",
        "toggleVisibility",
        "toggleBodyHighlight",
        "openElementDetail",
      ]),
    );
    await unmount(component);

    const menuTarget = document.createElement("div");
    document.body.append(menuTarget);
    const menu = mount(ContextMenu, {
      target: menuTarget,
      props: { controller, snapshot: createSnapshot(false) },
    });
    await unmount(menu);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(calls).not.toContain("clearContextMenu");
  });

  it("keeps body element detail bounded and routes its commands", async () => {
    const calls: string[] = [];
    const controller = {
      commands: createCommands(calls),
      elementDetailActions: {
        elementIdsForDetail: () => Array.from({ length: 10_000 }, (_, index) => index + 1),
        isElementSelected: (_instanceId: string, elementId: number) => elementId === 1,
      },
    } as unknown as WorkbenchController;
    const detail: WorkbenchElementDetailSnapshot = {
      instanceId: "1",
      bodyId: 1,
      label: "Body",
      partName: "Part",
      count: 10_000,
    };
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ElementDetail, { target, props: { controller, detail } });
    await tick();

    expect(target.querySelectorAll('[role="option"]').length).toBeLessThan(100);
    expect(target.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
    target
      .querySelector('[role="option"]')
      ?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    target
      .querySelector('[role="option"]')
      ?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    (target.querySelector('[role="option"]') as HTMLButtonElement).click();
    button(target, '[data-testid="element-detail-back"]').click();
    await tick();

    expect(calls).toEqual(
      expect.arrayContaining([
        "setElementDetailHover",
        "clearElementDetailHover",
        "selectElementDetail",
        "closeElementDetail",
      ]),
    );
    await unmount(component);
  });

  it("mounts only a bounded window for a large visibility hierarchy", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const base = visibilitySnapshot();
    const seed = base.rows[0];
    if (seed === undefined) throw new Error("Visibility fixture has no rows");
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      ...seed,
      key: `row:${index}`,
      testId: `row-${index}`,
      position: index + 1,
      setSize: 10_000,
    }));
    const component = mount(VisibilityTree, {
      target,
      props: { controller: undefined, visibility: { ...base, rows } },
    });
    await tick();

    expect(target.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100);
    await unmount(component);
  });
});

async function change(target: HTMLElement, selector: string, value: string): Promise<void> {
  const control = element(target, selector) as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
}

async function input(target: HTMLElement, selector: string, value: string): Promise<void> {
  const control = element(target, selector) as HTMLInputElement;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
}

function button(target: HTMLElement, selector: string): HTMLButtonElement {
  return element(target, selector) as HTMLButtonElement;
}

function element(target: HTMLElement, selector: string): HTMLElement {
  const value = target.querySelector<HTMLElement>(selector);
  if (value === null) throw new Error(`Missing ${selector}`);
  return value;
}

function fakeController(calls: string[]): WorkbenchController {
  return controllerWithCommands(calls);
}

function controllerWithCommands(calls: string[]): WorkbenchController {
  return { commands: createCommands(calls) } as unknown as WorkbenchController;
}

function connectableController(
  snapshot: WorkbenchSnapshot,
  calls: string[],
  commands: WorkbenchCommands = createCommands(calls),
): WorkbenchController {
  return {
    commands,
    subscribe: (listener: (current: WorkbenchSnapshot) => void) => {
      listener(snapshot);
      return () => calls.push("unsubscribe");
    },
  } as unknown as WorkbenchController;
}

function createCommands(calls: string[]): WorkbenchCommands {
  return new Proxy({} as WorkbenchCommands, {
    get:
      (_target, property: string) =>
      (..._args: readonly unknown[]) => {
        calls.push(property);
      },
  });
}

function createSnapshot(
  withResults: boolean,
  playback?: WorkbenchSnapshot["analysis"]["playback"],
): WorkbenchSnapshot {
  const preset = withResults ? createResultsPreset() : createBoltedPlatePreset();
  const model = createExampleModel(preset);
  const input: WorkbenchSnapshotInput = {
    model,
    models: [model],
    runtime: createSceneRuntime(model.scene),
    interaction: createInteractionState(),
    rendererName: "webgpu",
    rendererState: "",
    cameraMode: "perspective",
    background: "studio",
    toggles: { edges: true, nodes: true, diagnostics: false },
    continuous: false,
    selectionGranularity: "element",
    boxSelectionStrategy: "visible-surface",
    touchInteractionMode: "navigate",
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

function visibilitySnapshot(): WorkbenchSnapshot["hierarchy"]["visibility"] {
  const assembly: WorkbenchVisibilityRowSnapshot = {
    key: "assembly:1",
    target: { kind: "assembly", occurrenceId: "1" },
    kind: "assembly",
    depth: 1,
    label: "Root",
    badge: "Assembly",
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
  const bodyTarget: VisibilityRowTarget = { kind: "body", instanceId: "1", bodyId: 1 };
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
  return { context: "Assembly · Root", rows: [assembly, body] };
}

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
