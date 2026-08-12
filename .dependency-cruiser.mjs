/** @type {import("dependency-cruiser").IConfiguration} */

const subsystemDependencies = {
  math: [],
  elements: [],
  platform: [],
  geometry: ["math", "elements"],
  io: ["elements", "geometry", "interaction", "math", "scene"],
  camera: ["math", "geometry"],
  scene: ["math", "elements", "geometry"],
  "scene-runtime": ["math", "geometry", "scene"],
  interaction: ["camera", "elements", "geometry", "picking", "scene"],
  results: ["geometry", "interaction"],
  picking: ["math", "elements", "geometry", "scene"],
  renderer: [
    "camera",
    "geometry",
    "interaction",
    "math",
    "picking",
    "platform",
    "results",
    "scene",
    "scene-runtime",
  ],
  viewport: [
    "camera",
    "geometry",
    "interaction",
    "math",
    "picking",
    "platform",
    "renderer",
    "results",
    "scene",
    "scene-runtime",
  ],
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function subsystemRule(name, allowed) {
  const allowedPaths = [name, ...allowed].map((value) => `${escapeRegex(value)}/`).join("|");
  return {
    name: `no-${name}-imports-outside-subsystem-dag`,
    severity: "error",
    comment: `${name} may import only its own subsystem and the explicitly allowed lower-level owners: ${allowed.join(", ") || "none"}.`,
    from: { path: `^src/${escapeRegex(name)}/` },
    to: { path: `^src/(?!${allowedPaths})` },
  };
}

export default {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      comment: "Resolve the dependency cycle at its semantic owner; do not add an exception.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-production-root-barrel-imports",
      severity: "error",
      comment: "Production modules must use an owning subsystem boundary, never src/index.ts.",
      from: { path: "^src/(?!index\\.ts$)" },
      to: { path: "^src/index\\.ts$" },
    },
    {
      name: "no-production-demo-or-test-imports",
      severity: "error",
      comment: "Library source cannot depend on demo, test, or e2e code.",
      from: { path: "^src/" },
      to: { path: "^(?:demo|test|e2e)/" },
    },
    {
      name: "no-cross-subsystem-part-validation-imports",
      severity: "error",
      comment: "Use the deliberate geometry/part.ts boundary for geometry validation queries.",
      from: { path: "^src/(?!geometry/)" },
      to: { path: "^src/geometry/part-validation\\.ts$" },
    },
    {
      name: "viewport-uses-renderer-public-boundary",
      severity: "error",
      comment: "Viewport code may import renderer behavior only from renderer/gpu-renderer.ts.",
      from: { path: "^src/viewport/" },
      to: {
        path: "^src/renderer/",
        pathNot: "^src/renderer/gpu-renderer\\.ts$",
      },
    },
    ...Object.entries(subsystemDependencies).map(([name, allowed]) => subsystemRule(name, allowed)),
  ],
  options: {
    includeOnly: ["^src/"],
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "^node_modules/" },
  },
};
