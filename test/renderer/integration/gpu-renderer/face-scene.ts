import { createPart } from "@/geometry/part";
import { createSceneBuilder, type Scene } from "@/scene/scene";
import { identityMatrix } from "@/math/mat4";

/** Shared renderer fixture with authored face and edge topology. */
export function buildFaceScene(): Scene {
  const geometry = faceGeometry();
  const { elements, nodePositions, ...localGeometry } = geometry;
  return createSceneBuilder()
    .addPart(createPart(1, { geometries: [localGeometry], elements, nodePositions }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        {
          kind: "part",
          placementId: "0",
          partId: 1,
          transform: identityMatrix(),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}

function faceGeometry() {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  return {
    positions,
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    nodePositions: positions,
    faces: [
      {
        elementId: 0,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0:1:2",
        nodeIds: [0, 1, 2],
      },
    ],
    edges: [
      {
        key: "0,1",
        nodeIds: [0, 1],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
      {
        key: "0,2",
        nodeIds: [0, 2],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
      {
        key: "1,2",
        nodeIds: [1, 2],
        incidentElementIds: [0],
        faceRefs: [{ elementId: 0, faceIndex: 0 }],
      },
    ],
    elements: [
      {
        id: 0,
        primitiveRanges: [
          { primitive: "triangles" as const, primitiveStart: 0, primitiveCount: 1 },
        ],
      },
    ],
  };
}
