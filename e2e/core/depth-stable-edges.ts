import {
  createSceneBuilder,
  createPart,
  identityMatrix,
  type Scene,
  type Viewport,
} from "../../src/entries/root";
import {
  createInteractionState,
  setPartOverride,
  setTargetSelected,
} from "../../src/entries/interaction";
import {
  createElement,
  createElementModel,
  createPartFromElementModel,
  ElementShape,
} from "../../src/entries/model";
import { projectPoint, setProjection } from "../../src/entries/camera";

type SetStatus = (result: string, message: string, detail?: string) => void;

/** Builds a subdivided Hex8 block whose top and side have authored edge rows. */
export function depthStableEdgesScene(): Scene {
  const part = createPartFromElementModel(1, subdividedBlock());
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "depth-stable-edges",
      placements: [
        {
          kind: "part",
          placementId: "edge-surface",
          partId: 1,
          transform: identityMatrix(),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

/** Builds a fully covered authored edge behind a separate opaque surface. */
export function depthEdgeOcclusionScene(): Scene {
  const edgePart = createPartFromElementModel(
    1,
    createElementModel(new Float32Array([0, 0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2]), [
      createElement(1, ElementShape.Quad, [0, 1, 2, 3]),
    ]),
  );
  const occluder = createPart(2, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([
          0.1, -0.2, -0.2, 0.1, 2.2, -0.2, 0.1, 2.2, 2.2, 0.1, -0.2, 2.2,
        ]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      },
    ],
  });
  return createSceneBuilder()
    .addPart(edgePart)
    .addPart(occluder)
    .addAssembly({
      id: 1,
      name: "depth-edge-occlusion",
      placements: [
        {
          kind: "part",
          placementId: "edge",
          partId: edgePart.id,
          transform: identityMatrix(),
        },
        {
          kind: "part",
          placementId: "occluder",
          partId: occluder.id,
          transform: identityMatrix(),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

/** Presents representative shallow and steep authored-edge probes in perspective or orthographic mode. */
export function runDepthStableEdges(
  current: Viewport,
  setStatus: SetStatus,
  orthographic: boolean,
): void {
  current.presentation.setNodeSizePixels(12);
  current.view.fit({ durationMs: 0 });
  const camera = setProjection(current.view.camera, orthographic ? "orthographic" : "perspective");
  current.view.setCamera(
    { ...camera, position: [4, 3, 5], target: [1, 1, 0.2], up: [0, 1, 0] },
    { durationMs: 0 },
  );
  let interaction = setPartOverride(createInteractionState(), 1, { edge: true, nodes: true });
  for (const nodeId of [13, 14]) {
    interaction = setTargetSelected(
      interaction,
      { kind: "node", partOccurrenceId: "1/edge-surface", nodeId },
      true,
    );
  }
  current.interaction.set(interaction);
  current.render();
  const shallow = projectPoint(current.view.camera, [1, 1, 0.4]);
  const steep = projectPoint(current.view.camera, [2, 1, 0.2]);
  const interiorNode = projectPoint(current.view.camera, [1, 1, 0.4]);
  const exteriorNode = projectPoint(current.view.camera, [2, 1, 0.4]);
  if (
    shallow === undefined ||
    steep === undefined ||
    interiorNode === undefined ||
    exteriorNode === undefined
  )
    throw new Error("edge probes did not project");
  setStatus(
    "depth-stable-edges",
    "depth-stable-edges-ready",
    JSON.stringify({ shallow, steep, interiorNode, exteriorNode }),
  );
}

/** Presents the edge and its occluder along the camera axis. */
export function runDepthEdgeOcclusion(current: Viewport, setStatus: SetStatus): void {
  current.view.fit({ durationMs: 0 });
  current.view.setCamera(
    {
      ...setProjection(current.view.camera, "perspective"),
      position: [5, 1, 1],
      target: [0, 1, 1],
    },
    { durationMs: 0 },
  );
  current.interaction.set(setPartOverride(createInteractionState(), 1, { edge: true }));
  current.render();
  const covered = projectPoint(current.view.camera, [0, 1, 1]);
  if (covered === undefined) throw new Error("occluded edge probe did not project");
  setStatus("depth-edge-occlusion", "depth-edge-occlusion-ready", JSON.stringify({ covered }));
}

function subdividedBlock() {
  const positions: number[] = [];
  for (let z = 0; z <= 1; z += 1) {
    for (let y = 0; y <= 2; y += 1) {
      for (let x = 0; x <= 2; x += 1) positions.push(x, y, z * 0.4);
    }
  }
  const node = (x: number, y: number, z: number) => z * 9 + y * 3 + x;
  const elements = [];
  let id = 1;
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      elements.push(
        createElement(id++, ElementShape.Hex8, [
          node(x, y, 0),
          node(x + 1, y, 0),
          node(x + 1, y + 1, 0),
          node(x, y + 1, 0),
          node(x, y, 1),
          node(x + 1, y, 1),
          node(x + 1, y + 1, 1),
          node(x, y + 1, 1),
        ]),
      );
    }
  }
  return createElementModel(new Float32Array(positions), elements);
}
