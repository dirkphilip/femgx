import {
  createViewport,
  createPart,
  createSceneBuilder,
  identityMatrix,
  translationMatrix,
  WebGpuUnsupportedError,
  type Viewport,
} from "../../src/entries/root";
import {
  createInteractionState,
  setPartOccurrenceOverride,
  setPartOverride,
  setTargetHighlighted,
  setTargetSelected,
} from "../../src/entries/interaction";
import { createResultField } from "../../src/entries/results";
import { orbitCamera, projectPoint } from "../../src/entries/camera";
import {
  createSelectionPhaseController,
  selectionScene,
  type SelectionPhase,
} from "./selection-precedence";
import { runOccurrenceResults } from "./occurrence-results";
import { hardwareConformanceScene, runHardwareConformance } from "./hardware-conformance";

const canvasElement = document.querySelector<HTMLCanvasElement>("#core-canvas");
const statusElement = document.querySelector<HTMLOutputElement>("#core-status");
if (canvasElement === null || statusElement === null) {
  throw new Error("core host markup is incomplete");
}
const canvas = canvasElement;
const status = statusElement;
const stageElement = document.querySelector<HTMLElement>("#core-stage");
if (stageElement === null) throw new Error("core host stage is missing");
const stage: HTMLElement = stageElement;
let viewport: Viewport | undefined;

const hostWindow = window as typeof window & {
  femgxCore?: {
    destroy: () => void;
    toggleEmphasis?: () => void;
    setSelectionPhase?: (phase: SelectionPhase) => void;
  };
};

function setStatus(result: string, message: string, detail = message): void {
  status.dataset["result"] = result;
  status.dataset["detail"] = detail;
  status.textContent = message;
}

function coreScene(placementCount = 1, separated = false) {
  const part = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
        nodePickIds: new Uint32Array([1, 2, 3]),
        edges: [
          { key: "0,1", nodeIds: [0, 1], incidentElementIds: [1], faceRefs: [] },
          { key: "0,2", nodeIds: [0, 2], incidentElementIds: [1], faceRefs: [] },
          { key: "1,2", nodeIds: [1, 2], incidentElementIds: [1], faceRefs: [] },
        ],
        faces: [
          {
            elementId: 1,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "0,1,2",
            nodeIds: [0, 1, 2],
          },
        ],
      },
    ],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
    nodePositions: new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0]),
  });
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "core-foundation",
      placements: Array.from({ length: placementCount }, (_, index) => ({
        kind: "part" as const,
        partId: part.id,
        transform:
          index === 0
            ? identityMatrix()
            : translationMatrix(separated ? 0 : index * 2.5, 0, -0.2 * index),
      })),
    })
    .setRootAssembly(1)
    .build();
}

async function start(): Promise<void> {
  const caseName = new URLSearchParams(location.search).get("case") ?? "foundation";
  document.body.dataset["case"] = caseName;
  const selectionCase = caseName.startsWith("selection-precedence");
  const scene =
    caseName === "hardware-conformance"
      ? hardwareConformanceScene()
      : selectionCase
        ? selectionScene(
            caseName.includes("reverse") || caseName.includes("behind"),
            caseName.includes("behind"),
          )
        : coreScene(
            caseName === "instancing" ||
              caseName === "transparency" ||
              caseName === "occurrence-results"
              ? 2
              : 1,
            caseName === "transparency",
          );
  let frames = 0;
  try {
    viewport = await createViewport({
      canvas,
      scene,
      onRender: () => {
        frames += 1;
        canvas.dataset["frames"] = String(frames);
      },
      ...(caseName === "hardware-conformance" ? { orientationGizmo: { container: stage } } : {}),
    });
    hostWindow.femgxCore = {
      destroy: () => {
        viewport?.destroy();
        viewport = undefined;
        setStatus("destroyed", "Core viewport destroyed");
      },
    };
    canvas.dataset["ready"] = "true";
    setStatus("ready", "Core viewport ready");
    await runCase(caseName, viewport);
  } catch (error) {
    if (error instanceof WebGpuUnsupportedError) {
      setStatus("unsupported", `${error.name}:${error.reason}`);
      return;
    }
    setStatus("error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function runCase(caseName: string, current: Viewport): Promise<void> {
  switch (caseName) {
    case "foundation":
      return;
    case "instancing":
      runInstancing(current);
      return;
    case "picking":
      await runPicking(current);
      return;
    case "presentation":
      runPresentation(current);
      return;
    case "results":
      runResults(current);
      return;
    case "occurrence-results":
      runOccurrenceResults(current, setStatus);
      return;
    case "hardware-conformance":
      await runHardwareConformance(current, canvas, setStatus);
      return;
    case "camera":
      runCamera(current);
      return;
    case "transparency":
      runTransparency(current);
      return;
    case "emphasis-minimal":
    case "emphasis-feature":
    case "emphasis-transparent":
      runSelectedHighlight(current, caseName);
      return;
    case "selection-precedence-forward":
    case "selection-precedence-reverse":
    case "selection-precedence-behind":
      installSelectionPrecedence(current, caseName, caseName.includes("behind"));
      return;
    default:
      throw new Error(`Unknown core browser case ${caseName}`);
  }
}

function runInstancing(current: Viewport): void {
  setStatus("instancing", JSON.stringify(current.stats()));
}

async function runPicking(current: Viewport): Promise<void> {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const region = { left: 0, top: 0, right: width, bottom: height, width, height };
  const targets = await current.interaction.pickRegion(region, "element");
  const target = targets[0];
  if (target !== undefined) {
    current.interaction.set(
      setTargetSelected(
        setPartOverride(createInteractionState(), 1, { edge: true, nodes: true }),
        target,
        true,
      ),
    );
    current.render();
  }
  const projected = projectPoint(current.view.camera, [0, -0.2, 0]);
  const picked =
    projected === undefined
      ? undefined
      : await current.interaction.pick(projected[0], projected[1]);
  const edgeTargets = await current.interaction.pickRegion(region, "edge");
  current.visibility.setPartOccurrenceVisible("1/0", false);
  current.render();
  const hidden = await current.interaction.pickRegion(region, "element");
  current.visibility.setPartOccurrenceVisible("1/0", true);
  current.render();
  setStatus(
    "picking",
    JSON.stringify({
      region: targets.length,
      picked: picked?.kind ?? "none",
      edge: edgeTargets[0]?.kind ?? "none",
      hidden: hidden.length,
    }),
  );
}

function runPresentation(current: Viewport): void {
  const interaction = setPartOverride(createInteractionState(), 1, {
    color: { r: 0.2, g: 0.7, b: 1, a: 1 },
    edge: true,
    nodes: true,
  });
  current.interaction.set(interaction);
  current.presentation.setBackground("dark");
  current.presentation.setEdgeDepthTest(false);
  current.presentation.setPointSizePixels(10);
  current.presentation.setNodeSizePixels(12);
  current.resize();
  current.render();
  canvas.dataset["presentation"] = "dark,edge-free,nodes-12,points-10";
  setStatus(
    "presentation",
    JSON.stringify({ width: current.view.camera.width, height: current.view.camera.height }),
  );
}

function runResults(current: Viewport): void {
  const scalar = createResultField({
    id: "temperature",
    name: "Temperature",
    location: "nodal",
    shape: "scalar",
    count: 3,
    unit: "K",
    values: new Float32Array([0, 1, 2]),
  });
  const displacement = createResultField({
    id: "displacement",
    name: "Displacement",
    location: "nodal",
    shape: "vector",
    count: 3,
    unit: "mm",
    values: new Float32Array([0, 0, 0, 0.2, 0, 0, 0, 0.2, 0]),
  });
  current.results.set({
    scalar: { field: scalar },
    deformation: { field: displacement, scale: 1 },
  });
  current.presentation.setSectionPlane({ normal: [0, 0, 1], distance: 0.1 });
  const active = current.results.state;
  current.presentation.clearSectionPlane();
  current.render();
  setStatus(
    "results",
    JSON.stringify({
      scalar: active?.scalar?.field.id ?? "none",
      deformation: active?.deformation !== undefined,
      sectionCleared: current.presentation.sectionPlane === undefined,
    }),
  );
}

function runCamera(current: Viewport): void {
  const before = current.view.camera.position;
  current.view.setCamera(orbitCamera(current.view.camera, 0.35, 0.2), { durationMs: 0 });
  current.view.fit({ durationMs: 0 });
  const after = current.view.camera.position;
  setStatus(
    "camera",
    JSON.stringify({ moved: before.some((value, index) => value !== after[index]) }),
  );
}

function runTransparency(current: Viewport): void {
  let interaction = createInteractionState();
  interaction = setPartOccurrenceOverride(interaction, "1/0", {
    color: { r: 0.95, g: 0.25, b: 0.2, a: 1 },
    opacity: 0.45,
  });
  interaction = setPartOccurrenceOverride(interaction, "1/1", {
    color: { r: 0.2, g: 0.5, b: 1, a: 1 },
    opacity: 0.75,
  });
  current.interaction.set(interaction);
  current.render();
  hostWindow.femgxCore = {
    ...hostWindow.femgxCore,
    destroy: () => {
      current.destroy();
    },
    toggleEmphasis: () => {
      current.interaction.set(
        setTargetHighlighted(
          interaction,
          { kind: "element", partOccurrenceId: "1/0", elementId: 1 },
          true,
        ),
      );
      current.render();
      setStatus("transparency-emphasized", "front-element-emphasized");
    },
  };
  setStatus("transparency", "front-0.45-back-0.75");
}

function runSelectedHighlight(current: Viewport, caseName: string): void {
  const feature = caseName === "emphasis-feature";
  const transparent = caseName === "emphasis-transparent";
  let interaction = createInteractionState({
    highlighted: {
      color: { r: 0.1, g: 0.4, b: 1, a: 1 },
      emissive: 0.1,
      opacity: 0.5,
    },
    selected: {
      color: { r: 0.95, g: 0.5, b: 0.1, a: transparent ? 0.55 : 1 },
      opacity: 1,
    },
  });
  const target = { kind: "partOccurrence", partOccurrenceId: "1/0" } as const;
  interaction = setTargetHighlighted(interaction, target, true);
  interaction = setTargetSelected(interaction, target, true);
  if (feature) {
    current.results.set({
      scalar: {
        field: createResultField({
          id: "emphasis-result",
          name: "Emphasis result",
          location: "elemental",
          shape: "scalar",
          count: 2,
          unit: "unitless",
          values: new Float32Array([Number.NaN, 0.25]),
        }),
        range: { min: 0, max: 1 },
      },
    });
  }
  current.interaction.set(interaction);
  current.render();
  setStatus(caseName, "selected-plus-highlighted");
}

function installSelectionPrecedence(current: Viewport, caseName: string, behind: boolean): void {
  if (hostWindow.femgxCore === undefined) throw new Error("Core viewport host is not ready");
  const setSelectionPhase = createSelectionPhaseController({
    current,
    caseName,
    behind,
    setStatus,
  });
  hostWindow.femgxCore = { ...hostWindow.femgxCore, setSelectionPhase };
  setSelectionPhase("all-elemental");
}

window.addEventListener("beforeunload", () => viewport?.destroy(), { once: true });
void start();
