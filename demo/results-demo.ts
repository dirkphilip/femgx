import {
  advanceCase,
  createCamera,
  createCasePlayer,
  deformPositions,
  legend,
  mapScalar,
  projectPolygon,
  resizeCamera,
  sampleDisplacements,
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
  readonly playToggle: HTMLButtonElement;
  readonly caseToggle: HTMLButtonElement;
  readonly status: HTMLElement;
}

/** Mutable view state driven by the control bar. */
export interface ResultsDemoState {
  deformed: boolean;
  scalar: boolean;
  scale: number;
}

/** Locates the results demo's DOM nodes, throwing when the page is misconfigured. */
export function queryResultsView(): ResultsDemoView {
  const canvas = document.querySelector<HTMLCanvasElement>("#results-canvas");
  const deformedToggle = document.querySelector<HTMLButtonElement>("#results-deformed-toggle");
  const scalarToggle = document.querySelector<HTMLButtonElement>("#results-scalar-toggle");
  const scaleInput = document.querySelector<HTMLInputElement>("#results-scale");
  const playToggle = document.querySelector<HTMLButtonElement>("#results-play-toggle");
  const caseToggle = document.querySelector<HTMLButtonElement>("#results-case-toggle");
  const status = document.querySelector<HTMLElement>("#results-status");
  if (
    canvas === null ||
    deformedToggle === null ||
    scalarToggle === null ||
    scaleInput === null ||
    playToggle === null ||
    caseToggle === null ||
    status === null
  ) {
    throw new Error("missing results demo controls");
  }
  return { canvas, deformedToggle, scalarToggle, scaleInput, playToggle, caseToggle, status };
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

  const state: ResultsDemoState = { deformed: false, scalar: true, scale: 1 };
  if (fixture.cases.length === 0) {
    throw new Error("results fixture must define at least one load case");
  }
  let player = createCasePlayer(
    fixture.cases.map((caze) => caze.displacement),
    { caseDuration: 1, loop: "wrap", interpolate: true },
  );
  let playing = false;
  let lastFrameTime: number | undefined;

  function currentCase(): ResultsLoadCase {
    const caze = fixture.cases[player.caseIndex];
    if (caze === undefined) {
      throw new Error("results fixture has an empty load-case list");
    }
    return caze;
  }

  function render(): void {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const caze = currentCase();
    const positions = state.deformed
      ? deformPositions(
          fixture.mesh.positions,
          fixture.mesh.nodePickIds,
          sampleDisplacements(player),
          state.scale,
        )
      : fixture.mesh.positions;
    const triangleElements = fixture.mesh.triangleElements;
    for (let element = 0; element < fixture.mesh.indices.length / 3; element++) {
      const a = vertex(positions, fixture.mesh.indices[element * 3] ?? 0);
      const b = vertex(positions, fixture.mesh.indices[element * 3 + 1] ?? 0);
      const c = vertex(positions, fixture.mesh.indices[element * 3 + 2] ?? 0);
      const screen = projectPolygon(camera, [a, b, c]);
      if (screen.length < 3) continue;
      const color = state.scalar
        ? mapScalar(fixture.colorMap, caze.vonMises[triangleElements[element] ?? 0] ?? NaN)
        : fixture.baseColor;
      context.fillStyle = rgba(color);
      context.strokeStyle = "rgba(226, 232, 240, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(screen[0]?.[0] ?? 0, screen[0]?.[1] ?? 0);
      for (const point of screen.slice(1)) context.lineTo(point[0], point[1]);
      context.closePath();
      context.fill();
      context.stroke();
    }
    if (state.scalar) drawLegend(context, fixture);
    canvas.dataset["deformed"] = state.deformed ? "1" : "0";
    canvas.dataset["scalar"] = state.scalar ? "1" : "0";
    canvas.dataset["scale"] = String(state.scale);
    canvas.dataset["case"] = String(player.caseIndex);
    canvas.dataset["blend"] = player.blend.toFixed(3);
    canvas.dataset["playing"] = playing ? "1" : "0";
    updateStatus(caze);
  }

  function animate(time: number): void {
    if (playing && lastFrameTime !== undefined) {
      player = advanceCase(player, (time - lastFrameTime) / 1000);
    }
    lastFrameTime = time;
    render();
    if (playing) requestAnimationFrame(animate);
  }

  function updateStatus(caze: ResultsLoadCase): void {
    const missing = countMissing(caze.vonMises);
    const { min, max } = fixture.range;
    const motion = state.deformed
      ? player.blend > 0
        ? `deformed · blend ${player.blend.toFixed(2)}`
        : "deformed"
      : "undeformed";
    view.status.textContent =
      `${caze.name} · von Mises ${format(min)}–${format(max)} MPa · ` +
      `${missing} missing · ${motion}`;
  }

  view.deformedToggle.addEventListener("click", () => {
    state.deformed = !state.deformed;
    updateControls(state, view, currentCase().name, playing);
    render();
  });

  view.scalarToggle.addEventListener("click", () => {
    state.scalar = !state.scalar;
    updateControls(state, view, currentCase().name, playing);
    render();
  });

  view.scaleInput.addEventListener("input", () => {
    state.scale = Number(view.scaleInput.value);
    render();
  });

  view.caseToggle.addEventListener("click", () => {
    player = advanceCase(player, player.caseDuration);
    updateControls(state, view, currentCase().name, playing);
    render();
  });

  view.playToggle.addEventListener("click", () => {
    playing = !playing;
    lastFrameTime = undefined;
    if (playing) requestAnimationFrame(animate);
    updateControls(state, view, currentCase().name, playing);
    render();
  });

  updateControls(state, view, currentCase().name, playing);
  render();
}

function updateControls(
  state: ResultsDemoState,
  view: ResultsDemoView,
  caseName: string,
  playing: boolean,
): void {
  view.deformedToggle.textContent = state.deformed ? "Undeformed" : "Deformed";
  view.scalarToggle.textContent = state.scalar ? "Scalar: off" : "Scalar: von Mises";
  view.caseToggle.textContent = `Case: ${caseName}`;
  view.playToggle.textContent = playing ? "Pause" : "Play";
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
