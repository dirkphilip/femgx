import { afterEach, describe, expect, it } from "vitest";
import {
  AnalysisControls,
  DEFORMATION_OFF_VALUE,
  ModelSource,
  PrimaryToolbar,
  ResultLegend,
  change,
  createSnapshot,
  button,
  element,
  fakeController,
  input,
  mount,
  tick,
  unmount,
  withOverlayState,
} from "./support";
import type { WorkbenchSnapshot } from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench analysis-controls", () => {
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
    await change(target, "#selection-granularity", "part");
    await change(target, "#selection-granularity", "instance");
    await change(target, "#selection-granularity", "body");
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
    button(target, "#show-all").click();
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
    button(target, "#performance-lab").click();

    expect(calls).toEqual(
      expect.arrayContaining([
        "setBackground",
        "setSelectionGranularity",
        "setBoxSelectionStrategy",
        "selectAll",
        "showAll",
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
        "setCatalogMode",
        "toggleEdges",
        "toggleNodes",
        "toggleContinuous",
      ]),
    );

    await unmount(modelSource);
    await unmount(component);
  });

  it("exposes part and instance selection with element-only Through guidance", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(true) },
    });

    button(target, "#command-selection").click();
    const granularity = element(target, "#selection-granularity") as HTMLSelectElement;
    expect([...granularity.options].map((option) => option.value)).toEqual([
      "part",
      "instance",
      "body",
      "element",
      "face",
      "node",
      "edge",
    ]);
    expect(granularity.title).toContain("parts, instances");
    const strategy = element(target, "#box-selection-strategy") as HTMLSelectElement;
    expect(strategy.title).toContain("available only for Element");

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

  it("explains glyph and transform semantics through visible and accessible copy", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(true) },
    });
    button(target, "#command-analysis").click();
    await tick();

    expect(element(target, "#vector-transform").closest("label")?.textContent).toContain(
      "Transform as",
    );
    expect((element(target, "#vector-transform") as HTMLSelectElement).options[0]?.text).toBe(
      "Spatial direction",
    );
    expect((element(target, "#vector-transform") as HTMLSelectElement).options[1]?.text).toBe(
      "Surface normal",
    );
    expect(element(target, "#vector-glyph").getAttribute("aria-describedby")).toBe(
      "vector-glyph-help",
    );
    expect(element(target, "#vector-transform").getAttribute("aria-describedby")).toBe(
      "vector-transform-help",
    );
    expect(element(target, "#vector-glyph-help").textContent).toContain("Arrow preserves sign");
    expect(element(target, "#vector-transform-help").textContent).toContain("inverse-transpose");
    expect(element(target, "#vector-help").textContent).toContain("behind opaque model geometry");

    await unmount(component);
  });

  it("routes authored result playback controls and reflects its edge states", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const playback = {
      label: "Authored load snapshots",
      range: { min: 10, max: 100 },
      scalar: {
        id: "demo-temperature-snapshot-0",
        name: "Demo temperature · Snapshot 1",
        location: "nodal",
        unit: "C",
      },
      deformation: {
        id: "demo-displacement-snapshot-0",
        name: "Demo displacement snapshot",
        location: "nodal",
        unit: "mm",
      },
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
    expect((element(target, "#result-field") as HTMLSelectElement).value).toBe(
      "demo-temperature-snapshot-0",
    );
    expect((element(target, "#result-field") as HTMLSelectElement).selectedOptions[0]?.text).toBe(
      "Demo temperature · Snapshot 1 · Nodal · Unit C · Snapshot 1",
    );
    expect((element(target, "#deformation-field") as HTMLSelectElement).value).toBe(
      "demo-displacement-snapshot-0",
    );
    expect(element(target, "#result-playback-owner").textContent).toContain(
      "Demo temperature · Snapshot 1 · Nodal · Unit C · Snapshot 1",
    );
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

  it("renders the section summary only for an active section snapshot", async () => {
    const target = document.createElement("div");
    document.body.append(target);

    const absent = mount(ResultLegend, { target, props: { snapshot: undefined } });
    expect(target.querySelector("#result-legend-section")).toBeNull();
    await unmount(absent);

    const snapshot = withOverlayState(createSnapshot(true));
    const activeSnapshot: WorkbenchSnapshot = {
      ...snapshot,
      overlays: {
        ...snapshot.overlays,
        resultLegend: {
          ...snapshot.overlays.resultLegend,
          section: { axis: "x", offset: 12.5 },
        },
      },
    };
    const active = mount(ResultLegend, { target, props: { snapshot: activeSnapshot } });
    expect(element(target, "#result-legend-section").textContent).toContain("Keep +X");
    expect(element(target, "#result-legend-section").textContent).toContain("Offset 12.5");
    await unmount(active);
  });
});
