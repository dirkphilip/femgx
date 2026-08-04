import {
  createCamera,
  deformPositions,
  legend,
  mapScalar,
  projectPoint,
  resizeCamera,
  type Color,
} from "../src/index";
import type { ResultsFixture, ResultsLoadCase } from "./results-fixture";

/** Model dimensions used to frame the camera, matching the results fixture. */
const WIDTH = 6;
const DEPTH = 4;

/** Typed handles to the results demo's DOM nodes. */
export interface ResultsDemoView {
  readonly canvas: HTMLCanvasElement;
  readonly deformedToggle: HTMLButtonElement;
  readonly scalarToggle: HTMLButtonElement;
  readonly scaleInput: HTMLInputElement;
  readonly caseToggle: HTMLButtonElement;
  readonly status: HTMLElement;
}

/** Mutable view state driven by the control bar. */
export interface ResultsDemoState {
  deformed: boolean;
  scalar: boolean;
  scale: number;
  caseIndex: number;
}

/** Locates the results demo's DOM nodes, throwing when the page is misconfigured. */
export function queryResultsView(): ResultsDemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#results-canvas");
  const deformedToggle = document.querySelector<HTMLButtonElement>("#results-deformed-toggle");
  const scalarToggle = document.querySelector<HTMLButtonElement>("#results-scalar-toggle");
  const scaleInput = document.querySelector<HTMLInputElement>("#results-scale");
  const caseToggle = document.querySelector<HTMLButtonElement>("#results-case-toggle");
  const status = document.querySelector<HTMLElement>("#results-status");
  if (
    canvas === null ||
    deformedToggle === null ||
    scalarToggle === null ||
    scaleInput === null ||
    caseToggle === null ||
    status === null
  ) {
    throw new Error("missing results demo controls");
  }
  return { canvas, deformedToggle, scalarToggle, scaleInput, caseToggle, status };
}

/**
 * Starts the deterministic 2D canvas renderer for the results demo: a
 * triangulated plate colored by von Mises stress, with an optional deformed
 * shape driven by a nodal displacement field and a configurable scale.
 */
export function startResultsDemo(view: ResultsDemoView, fixture: ResultsFixture): void {
  const { canvas } = view;
  const contextElement = canvas.getContext("2d");
  if (contextElement === null) {
    throw new Error("2d context unavailable");
  }
  const context: CanvasRenderingContext2D = contextElement;
  canvas.dataset["renderer"] = "cpu";

  const camera = resizeCamera(
    createCamera({
      target: [WIDTH / 2, DEPTH / 2, 0],
      position: [WIDTH / 2 + 4, DEPTH / 2 + 4, 7],
    }),
    canvas.width,
    canvas.height,
  );

  const state: ResultsDemoState = { deformed: false, scalar: true, scale: 1, caseIndex: 0 };
  if (fixture.cases.length === 0) {
    throw new Error("results fixture must define at least one load case");
  }

  function currentCase(): ResultsLoadCase {
    const caze = fixture.cases[state.caseIndex % fixture.cases.length];
    if (caze === undefined) {
      throw new Error("results fixture has an empty load-case list");
    }
    return caze;
  }

  function render(): void {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const caze = currentCase();
    const positions = state.deformed
      ? deformPositions(fixture.mesh.positions, caze.displacement, state.scale)
      : fixture.mesh.positions;
    for (let element = 0; element < fixture.mesh.indices.length / 3; element++) {
      const a = vertex(positions, fixture.mesh.indices[element * 3] ?? 0);
      const b = vertex(positions, fixture.mesh.indices[element * 3 + 1] ?? 0);
      const c = vertex(positions, fixture.mesh.indices[element * 3 + 2] ?? 0);
      const pa = projectPoint(camera, a);
      const pb = projectPoint(camera, b);
      const pc = projectPoint(camera, c);
      if (pa === undefined || pb === undefined || pc === undefined) continue;
      const color = state.scalar
        ? mapScalar(fixture.colorMap, caze.vonMises[element] ?? NaN)
        : fixture.baseColor;
      context.fillStyle = rgba(color);
      context.strokeStyle = "rgba(226, 232, 240, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pa[0], pa[1]);
      context.lineTo(pb[0], pb[1]);
      context.lineTo(pc[0], pc[1]);
      context.closePath();
      context.fill();
      context.stroke();
    }
    if (state.scalar) drawLegend(context, fixture);
    canvas.dataset["deformed"] = state.deformed ? "1" : "0";
    canvas.dataset["scalar"] = state.scalar ? "1" : "0";
    canvas.dataset["scale"] = String(state.scale);
    canvas.dataset["case"] = String(state.caseIndex);
    updateStatus(caze);
  }

  function updateStatus(caze: ResultsLoadCase): void {
    const missing = countMissing(caze.vonMises);
    const { min, max } = fixture.range;
    view.status.textContent =
      `${caze.name} · von Mises ${format(min)}–${format(max)} MPa · ` +
      `${missing} missing · ${state.deformed ? "deformed" : "undeformed"}`;
  }

  view.deformedToggle.addEventListener("click", () => {
    state.deformed = !state.deformed;
    view.deformedToggle.textContent = state.deformed ? "Undeformed" : "Deformed";
    render();
  });

  view.scalarToggle.addEventListener("click", () => {
    state.scalar = !state.scalar;
    view.scalarToggle.textContent = state.scalar ? "Scalar: off" : "Scalar: von Mises";
    render();
  });

  view.scaleInput.addEventListener("input", () => {
    state.scale = Number(view.scaleInput.value);
    render();
  });

  view.caseToggle.addEventListener("click", () => {
    state.caseIndex = (state.caseIndex + 1) % fixture.cases.length;
    view.caseToggle.textContent = `Case: ${currentCase().name}`;
    render();
  });

  updateControls(state, view, fixture.cases[0]?.name ?? "");
  render();
}

function updateControls(state: ResultsDemoState, view: ResultsDemoView, caseName: string): void {
  view.deformedToggle.textContent = state.deformed ? "Undeformed" : "Deformed";
  view.scalarToggle.textContent = state.scalar ? "Scalar: off" : "Scalar: von Mises";
  view.caseToggle.textContent = `Case: ${caseName}`;
}

function vertex(positions: Float32Array, index: number): readonly [number, number, number] {
  const base = index * 3;
  return [positions[base] ?? 0, positions[base + 1] ?? 0, positions[base + 2] ?? 0];
}

function drawLegend(context: CanvasRenderingContext2D, fixture: ResultsFixture): void {
  const x = 16;
  const y = 14;
  const width = 240;
  const height = 12;
  const gradient = context.createLinearGradient(x, y, x + width, y);
  for (const stop of fixture.colorMap.stops) {
    gradient.addColorStop(stop.offset, rgba(stop.color));
  }
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
  const entries = legend(fixture.colorMap);
  const first = entries[0];
  const last = entries[entries.length - 1];
  context.fillStyle = "#e2e8f0";
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "bottom";
  context.textAlign = "left";
  context.fillText(first?.label ?? "", x, y - 2);
  context.textAlign = "right";
  context.fillText(last?.label ?? "", x + width, y - 2);
  const missing = fixture.colorMap.missingColor;
  context.fillStyle = rgba(missing);
  context.fillRect(x + width + 14, y, height, height);
  context.fillStyle = "#e2e8f0";
  context.textAlign = "left";
  context.fillText("missing", x + width + 14 + height + 4, y - 2);
}

function countMissing(values: Float32Array): number {
  let count = 0;
  for (const value of values) {
    if (Number.isNaN(value)) count += 1;
  }
  return count;
}

function rgba(color: Color): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${color.a})`;
}

function format(value: number): string {
  return Number(value.toPrecision(3)).toString();
}
