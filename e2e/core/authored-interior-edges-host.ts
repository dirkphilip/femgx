import {
  createElement,
  createElementModel,
  createPartFromElementModel,
  ElementShape,
} from "../../src/entries/model";
import { createInteractionState } from "../../src/entries/interaction";
import { projectPoint } from "../../src/entries/camera";
import {
  createSceneBuilder,
  createViewport,
  translationMatrix,
  WebGpuUnsupportedError,
  type Viewport,
} from "../../src/entries/root";

const canvas = document.querySelector<HTMLCanvasElement>("#interior-edge-canvas");
const status = document.querySelector<HTMLOutputElement>("#interior-edge-status");
if (canvas === null || status === null) throw new Error("interior-edge host markup is incomplete");
const hostCanvas = canvas;
const hostStatus = status;

function setStatus(result: string, detail: Record<string, unknown> = {}): void {
  hostStatus.dataset["result"] = result;
  hostStatus.dataset["detail"] = JSON.stringify(detail);
  hostStatus.textContent = result;
}

function interiorEdgeScene() {
  const model = createElementModel(
    new Float32Array([0, 0, -1, 0, 0, 1, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]),
    [
      createElement(1, ElementShape.Tet4, [0, 1, 2, 3]),
      createElement(2, ElementShape.Tet4, [0, 1, 3, 4]),
      createElement(3, ElementShape.Tet4, [0, 1, 4, 5]),
      createElement(4, ElementShape.Tet4, [0, 1, 5, 2]),
    ],
  );
  const part = createPartFromElementModel(1, model);
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "authored-interior-edge-cavity",
      placements: [
        {
          kind: "part" as const,
          placementId: "cavity",
          partId: part.id,
          transform: translationMatrix(2, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

async function run(viewport: Viewport): Promise<void> {
  viewport.view.fit({ durationMs: 0 });
  viewport.view.setCamera(
    {
      ...viewport.view.camera,
      position: [5, 3, 5],
      target: [2, 0, 0],
      up: [0, 1, 0],
    },
    { durationMs: 0 },
  );
  viewport.interaction.set(createInteractionState());
  viewport.presentation.setEdgesVisible(true);
  viewport.visibility.setElementVisible({ partOccurrenceId: "1/cavity", elementId: 1 }, false);
  viewport.render();
  await presentedFrame();
  await presentedFrame();
  const probe = projectPoint(viewport.view.camera, [2, 0, 0]);
  const edgeStart = projectPoint(viewport.view.camera, [2, 0, -1]);
  const edgeEnd = projectPoint(viewport.view.camera, [2, 0, 1]);
  const visibleEdgeProbe = projectPoint(viewport.view.camera, [2, -0.5, -0.5]);
  if (probe === undefined || edgeStart === undefined || edgeEnd === undefined)
    throw new Error("interior edge probe did not project");
  const picked = await pickInteriorEdge(viewport, edgeStart, edgeEnd);
  const width = hostCanvas.clientWidth;
  const height = hostCanvas.clientHeight;
  const region = await viewport.interaction.pickRegion(
    { left: 0, top: 0, right: width, bottom: height, width, height },
    "edge",
  );
  setStatus("authored-interior-edges-ready", {
    probe,
    edgeStart,
    edgeEnd,
    visibleEdgeProbe,
    edgeKeys: region.map((target) => target.key),
    pickKey: picked?.kind === "edge" ? picked.key : "none",
  });
}

async function pickInteriorEdge(
  viewport: Viewport,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
) {
  for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const probe: readonly [number, number] = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ];
    const picked = await viewport.interaction.pick(probe[0], probe[1], "edge");
    if (picked !== undefined) return picked;
  }
  return undefined;
}

function presentedFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

try {
  const viewport = await createViewport({ canvas: hostCanvas, scene: interiorEdgeScene() });
  hostCanvas.dataset["ready"] = "true";
  await run(viewport);
} catch (error) {
  if (error instanceof WebGpuUnsupportedError) {
    setStatus("unsupported", { reason: error.reason });
  } else {
    setStatus("error", { message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
