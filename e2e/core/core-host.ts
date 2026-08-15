import {
  createInteractionState,
  createResultField,
  createFemViewport,
  createPart,
  createScene,
  identity,
  setInstanceOverride,
  setPartOverride,
  setTargetHighlighted,
  setTargetSelected,
  translation,
  WebGpuUnsupportedError,
  type FemViewport,
} from "../../src/entries/root";
import { orbitCamera, projectPoint } from "../../src/entries/camera";

const canvasElement = document.querySelector<HTMLCanvasElement>("#core-canvas");
const statusElement = document.querySelector<HTMLOutputElement>("#core-status");
if (canvasElement === null || statusElement === null) {
  throw new Error("core host markup is incomplete");
}
const canvas = canvasElement;
const status = statusElement;
let viewport: FemViewport | undefined;

const hostWindow = window as typeof window & {
  femgxCore?: {
    destroy: () => void;
    toggleEmphasis?: () => void;
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
            neighborElementIds: [],
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
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "core-foundation",
      placements: Array.from({ length: placementCount }, (_, index) => ({
        kind: "part" as const,
        partId: part.id,
        transform:
          index === 0 ? identity() : translation(separated ? 0 : index * 2.5, 0, -0.2 * index),
      })),
    })
    .withRoot(1)
    .build();
}

async function start(): Promise<void> {
  const caseName = new URLSearchParams(location.search).get("case") ?? "foundation";
  const scene = coreScene(
    caseName === "instancing" || caseName === "transparency" ? 2 : 1,
    caseName === "transparency",
  );
  let frames = 0;
  try {
    viewport = await createFemViewport({
      canvas,
      scene,
      onRender: () => {
        frames += 1;
        canvas.dataset["frames"] = String(frames);
      },
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

async function runCase(caseName: string, current: FemViewport): Promise<void> {
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
    case "camera":
      runCamera(current);
      return;
    case "transparency":
      runTransparency(current);
      return;
    default:
      throw new Error(`Unknown core browser case ${caseName}`);
  }
}

function runInstancing(current: FemViewport): void {
  setStatus("instancing", JSON.stringify(current.stats()));
}

async function runPicking(current: FemViewport): Promise<void> {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const region = { left: 0, top: 0, right: width, bottom: height, width, height };
  const targets = await current.pickRegion(region, "element");
  const target = targets[0];
  if (target !== undefined) {
    current.setInteraction(
      setTargetSelected(
        setPartOverride(createInteractionState(), 1, { edge: true, nodes: true }),
        target,
        true,
      ),
    );
    current.render();
  }
  const projected = projectPoint(current.camera, [0, -0.2, 0]);
  const picked =
    projected === undefined ? undefined : await current.pick(projected[0], projected[1]);
  const edgeTargets = await current.pickRegion(region, "edge");
  current.setInstanceVisible("1/0", false);
  current.render();
  const hidden = await current.pickRegion(region, "element");
  current.setInstanceVisible("1/0", true);
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

function runPresentation(current: FemViewport): void {
  const interaction = setPartOverride(createInteractionState(), 1, {
    color: { r: 0.2, g: 0.7, b: 1, a: 1 },
    edge: true,
    nodes: true,
  });
  current.setInteraction(interaction);
  current.setBackground("dark");
  current.setEdgeDepthTest(false);
  current.setPointSizePixels(10);
  current.setNodeSizePixels(12);
  current.resize();
  current.render();
  canvas.dataset["presentation"] = "dark,edge-free,nodes-12,points-10";
  setStatus(
    "presentation",
    JSON.stringify({ width: current.camera.width, height: current.camera.height }),
  );
}

function runResults(current: FemViewport): void {
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
  current.setResults({ scalar: { field: scalar }, deformation: { field: displacement, scale: 1 } });
  current.setSectionPlane({ normal: [0, 0, 1], distance: 0.1 });
  const active = current.results;
  current.clearSectionPlane();
  current.render();
  setStatus(
    "results",
    JSON.stringify({
      scalar: active?.scalar?.field.id ?? "none",
      deformation: active?.deformation !== undefined,
      sectionCleared: current.sectionPlane === undefined,
    }),
  );
}

function runCamera(current: FemViewport): void {
  const before = current.camera.position;
  current.setCamera(orbitCamera(current.camera, 0.35, 0.2), { durationMs: 0 });
  current.fitView({ durationMs: 0 });
  const after = current.camera.position;
  setStatus(
    "camera",
    JSON.stringify({ moved: before.some((value, index) => value !== after[index]) }),
  );
}

function runTransparency(current: FemViewport): void {
  let interaction = createInteractionState();
  interaction = setInstanceOverride(interaction, "1/0", {
    color: { r: 0.95, g: 0.25, b: 0.2, a: 1 },
    opacity: 0.45,
  });
  interaction = setInstanceOverride(interaction, "1/1", {
    color: { r: 0.2, g: 0.5, b: 1, a: 1 },
    opacity: 0.75,
  });
  current.setInteraction(interaction);
  current.render();
  hostWindow.femgxCore = {
    ...hostWindow.femgxCore,
    destroy: () => {
      current.destroy();
    },
    toggleEmphasis: () => {
      current.setInteraction(
        setTargetHighlighted(
          interaction,
          { kind: "element", instanceId: "1/0", elementId: 1 },
          true,
        ),
      );
      current.render();
      setStatus("transparency-emphasized", "front-element-emphasized");
    },
  };
  setStatus("transparency", "front-0.45-back-0.75");
}

window.addEventListener("beforeunload", () => viewport?.destroy(), { once: true });
void start();
