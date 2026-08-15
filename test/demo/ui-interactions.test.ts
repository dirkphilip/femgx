import { tick, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { createInteractionState, createSceneRuntime } from "../../src/index";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { createResultsPreset } from "../../demo/fixture/results-preset";
import { createExampleModel } from "../../demo/workbench/model";
import type { WorkbenchController } from "../../demo/workbench/controller";
import type { WorkbenchCommands, WorkbenchSnapshot } from "../../demo/workbench/snapshot";
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
import WorkbenchApp from "../../demo/workbench/ui/WorkbenchApp.svelte";

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
    await unmount(workspace);

    const legend = mount(ResultLegend, { target, props: { snapshot } });
    expect(element(target, "#result-legend").hidden).toBe(false);
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

function connectableController(snapshot: WorkbenchSnapshot, calls: string[]): WorkbenchController {
  return {
    commands: createCommands(calls),
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

function createSnapshot(withResults: boolean): WorkbenchSnapshot {
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
      resultLegend: { visible: true, text: "Demo stress\nRange 10 – 80" },
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
