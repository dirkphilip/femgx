import { computeBounds, createScene, flattenAssembly, translation } from "../src/index";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (canvas === null) {
  throw new Error("missing #view canvas");
}

const geometry = {
  positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const scene = createScene()
  .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
  .addAssembly({
    id: 1,
    name: "root",
    placements: [
      { kind: "part", partId: 1, transform: translation(-1, 0, 0) },
      { kind: "part", partId: 1, transform: translation(0, 1, 0) },
      { kind: "part", partId: 1, transform: translation(1, 0, 0) },
    ],
  })
  .withRoot(1)
  .build();

const instances = flattenAssembly({
  assemblyId: scene.rootAssemblyId,
  assemblies: scene.assemblies,
  visibleAssemblyIds: scene.visibleAssemblyIds,
  visiblePartIds: scene.visiblePartIds,
});

const context = canvas.getContext("2d");
if (context === null) {
  throw new Error("2d context unavailable");
}

for (const instance of instances) {
  context.fillStyle = "#3b82f6";
  context.beginPath();
  const tx = instance.worldTransform[12] ?? 0;
  const ty = instance.worldTransform[13] ?? 0;
  const x = 100 + tx * 100;
  const y = 100 - ty * 100;
  context.arc(x, y, 24, 0, Math.PI * 2);
  context.fill();
}
