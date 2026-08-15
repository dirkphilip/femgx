import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { parsePackResult, runCommand } from "./package-smoke-helpers.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), "femgx-smoke-"));
  const consumer = join(tmp, "consumer");
  const tarballDir = join(tmp, "pack");
  const buildCache = join(tmp, "npm-cache-build");
  const packCache = join(tmp, "npm-cache-pack");
  const installCache = join(tmp, "npm-cache-install");
  const userConfig = join(tmp, "npmrc");
  const consumerNodeModules = join(consumer, "node_modules", "femgx");
  const env = isolatedNpmEnvironment(buildCache, userConfig);
  try {
    mkdirSync(tarballDir);
    mkdirSync(consumer);
    writeFileSync(userConfig, "\n");
    // 1. Build the library from source.
    runCommand("npm", ["run", "build"], repoRoot, env);
    checkBundleBudgets(repoRoot);

    // 2. Pack the publishable tarball.
    console.log("Packing package...");
    const packOutput = runCommand(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--progress=false",
        "--update-notifier=false",
        "--cache",
        packCache,
        "--userconfig",
        userConfig,
        "--pack-destination",
        tarballDir,
      ],
      repoRoot,
      env,
    );
    const packResult = parsePackResult(packOutput.stdout, packOutput.stderr);
    const tarball = join(tarballDir, packResult.filename);
    const tarballFiles = packResult.files.map((entry) => entry.path);
    console.log(`Packed ${packResult.filename} (${tarballFiles.length} files)`);

    // 3. Sanity-check tarball contents: declarations, no source/demo leakage.
    const publicEntries = ["model", "io", "io/glb", "camera", "runtime", "platform"];
    const expectedArtifacts = [
      "dist/femgx.js",
      "dist/femgx.cjs",
      "dist/entries/root.d.ts",
      "dist/cjs/entries/root.d.cts",
      ...publicEntries.flatMap((entry) => [
        `dist/${entry}.js`,
        `dist/${entry}.cjs`,
        `dist/${entry === "io/glb" ? "io/glb" : entry}.d.ts`,
        `dist/cjs/${entry === "io/glb" ? "io/glb" : entry}.d.cts`,
      ]),
    ];
    for (const artifact of expectedArtifacts) {
      expect(tarballFiles.includes(artifact), `missing ${artifact} in tarball`);
    }
    expect(tarballFiles.includes("package.json"), "missing package.json in tarball");
    expect(tarballFiles.includes("README.md"), "missing README.md in tarball");
    expect(
      !tarballFiles.some((path) => path.startsWith("dist/fixture")),
      "tarball includes internal demo fixture declarations",
    );
    const leaked = tarballFiles.filter(
      (path) =>
        path.startsWith("src/") ||
        path.startsWith("demo/") ||
        path.startsWith("test/") ||
        path.startsWith("e2e/") ||
        path.startsWith("wiki/") ||
        path.startsWith("scripts/") ||
        (path.endsWith(".ts") && !path.endsWith(".d.ts")),
    );
    expect(leaked.length === 0, `tarball leaks non-publishable files: ${leaked.join(", ")}`);

    // 4. Validate the dual ESM/CJS types against the exports map with
    //    @arethetypeswrong/cli (attw). Fails on any finding so hazards such as
    //    masquerading as CJS/ESM or wrong types-condition placement cannot slip in.
    console.log("Running @arethetypeswrong/cli on the packed tarball...");
    const attw = join(repoRoot, "node_modules", ".bin", "attw");
    let attwOutput;
    try {
      // TypeScript's legacy node10 resolver cannot interpret package exports for
      // subpaths. The explicit root-only node10 smoke below remains required;
      // attw still checks every entry under node16 and bundler resolution.
      attwOutput = runCommand(
        attw,
        [tarball, "--no-color", "--no-emoji", "--ignore-rules", "no-resolution"],
        repoRoot,
        env,
      ).stdout;
    } catch (error) {
      throw new Error(`@arethetypeswrong/cli found type-resolution problems:\n${error.message}`, {
        cause: error,
      });
    }
    console.log(attwOutput.trim());

    // 5. Install into a clean consumer project (no dev tooling, no registry access).
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "femgx-consumer", private: true, version: "0.0.0", type: "module" }),
    );
    console.log("Installing tarball into clean consumer...");
    runCommand(
      "npm",
      [
        "install",
        tarball,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--offline",
        "--cache",
        installCache,
        "--userconfig",
        userConfig,
      ],
      consumer,
      isolatedNpmEnvironment(installCache, userConfig),
    );

    const installedPkg = JSON.parse(
      readFileSync(join(consumerNodeModules, "package.json"), "utf8"),
    );
    expect(
      installedPkg.dependencies === undefined,
      "published package must have no runtime dependencies",
    );
    expect(installedPkg.private !== true, "published package must not be private");
    expect(
      !("preinstall" in installedPkg.scripts),
      "published package must not carry a preinstall script",
    );
    const expectedExports = {
      ".": ["dist/entries/root.d.ts", "dist/cjs/entries/root.d.cts"],
      ...Object.fromEntries(
        publicEntries.map((entry) => [
          `./${entry}`,
          [
            `dist/${entry === "io/glb" ? "io/glb" : entry}.d.ts`,
            `dist/cjs/${entry === "io/glb" ? "io/glb" : entry}.d.cts`,
          ],
        ]),
      ),
    };
    expect(
      Object.keys(installedPkg.exports).sort().join(",") ===
        [...Object.keys(expectedExports), "./package.json"].sort().join(","),
      "package exports contain an undeclared or missing entry",
    );
    for (const [entry, [importTypes, requireTypes]] of Object.entries(expectedExports)) {
      expect(
        installedPkg.exports[entry]?.import?.types === `./${importTypes}`,
        `${entry} import types condition is wrong`,
      );
      expect(
        installedPkg.exports[entry]?.require?.types === `./${requireTypes}`,
        `${entry} require types condition is wrong`,
      );
    }
    expect(
      !existsSync(join(consumerNodeModules, "node_modules")),
      "published package pulled in unexpected dependencies",
    );

    // 6. ESM import at runtime.
    writeFileSync(
      join(consumer, "smoke.mjs"),
      [
        'import { boxSelectionFrustum, createInteractionState, createScene, identity, setInstanceOverride, setPartOverride } from "femgx";',
        'import { createCamera } from "femgx/camera";',
        'import * as model from "femgx/model";',
        'import * as io from "femgx/io";',
        'import * as glb from "femgx/io/glb";',
        'import * as runtime from "femgx/runtime";',
        'import * as platform from "femgx/platform";',
        "const scene = createScene();",
        "const camera = createCamera();",
        'if (camera.mode !== "orthographic") throw new Error("orthographic default failed");',
        "const frustum = boxSelectionFrustum(camera, { left: 0, top: 0, right: camera.width, bottom: camera.height, width: camera.width, height: camera.height });",
        'if (frustum.near.normal.length !== 3) throw new Error("frustum export failed");',
        "const m = identity();",
        'if (m.length !== 16) throw new Error("identity() is not a 4x4 matrix");',
        'if (typeof setPartOverride !== "function" || typeof setInstanceOverride !== "function") throw new Error("instance override exports failed");',
        "let interaction = createInteractionState();",
        "interaction = setPartOverride(interaction, 1, { lineWidthPixels: 2 });",
        'interaction = setInstanceOverride(interaction, "1/0", { lineWidthPixels: 3 });',
        'if (typeof model.createElementModel !== "function") throw new Error("model entry failed");',
        'if (typeof io.parseVtk !== "function") throw new Error("io entry failed");',
        'if (typeof glb.importGlb !== "function") throw new Error("GLB entry failed");',
        'if (typeof runtime.createSceneRuntime !== "function") throw new Error("runtime entry failed");',
        'if (typeof platform.queryWebGpuSupport !== "function") throw new Error("platform entry failed");',
        'console.log("ESM import OK");',
      ].join("\n"),
    );
    console.log(runCommand("node", ["smoke.mjs"], consumer).stdout.trim());

    // 7. CommonJS require at runtime.
    writeFileSync(
      join(consumer, "smoke.cjs"),
      [
        'const { createInteractionState, createScene, identity, setInstanceOverride, setPartOverride } = require("femgx");',
        'const { createCamera } = require("femgx/camera");',
        'const model = require("femgx/model");',
        'const io = require("femgx/io");',
        'const glb = require("femgx/io/glb");',
        'const runtime = require("femgx/runtime");',
        'const platform = require("femgx/platform");',
        "const scene = createScene();",
        "const camera = createCamera();",
        'if (camera.mode !== "orthographic") throw new Error("orthographic default failed");',
        'if (identity().length !== 16) throw new Error("identity() is not a 4x4 matrix");',
        'if (typeof setPartOverride !== "function" || typeof setInstanceOverride !== "function") throw new Error("instance override exports failed");',
        "let interaction = createInteractionState();",
        "interaction = setPartOverride(interaction, 1, { lineWidthPixels: 2 });",
        'interaction = setInstanceOverride(interaction, "1/0", { lineWidthPixels: 3 });',
        'if (typeof model.createElementModel !== "function") throw new Error("model entry failed");',
        'if (typeof io.parseVtk !== "function") throw new Error("io entry failed");',
        'if (typeof glb.importGlb !== "function") throw new Error("GLB entry failed");',
        'if (typeof runtime.createSceneRuntime !== "function") throw new Error("runtime entry failed");',
        'if (typeof platform.queryWebGpuSupport !== "function") throw new Error("platform entry failed");',
        'console.log("CJS require OK");',
      ].join("\n"),
    );
    console.log(runCommand("node", ["smoke.cjs"], consumer).stdout.trim());

    // 8. Type-level consumption under each supported moduleResolution.
    const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
    const smokeTs = [
      'import { boxSelectionFrustum, createFemViewport, createInteractionState, createPart, createResultField, createScene, identity, setInstanceOverride, setPartOverride, setTargetHighlighted, setTargetSelected, translation, type FemViewport, type InteractionTarget, type StyleOverride } from "femgx";',
      'import { createElement, createElementModel, elementPart, LINE_SHAPE, POINT_SHAPE, TRIANGLE_SHAPE } from "femgx/model";',
      'import { parseVtk, writeVtk } from "femgx/io";',
      'import { createCamera } from "femgx/camera";',
      'import type { GlbSceneImport } from "femgx/io/glb";',
      'import type { SceneRuntime } from "femgx/runtime";',
      'import type { RequestedWebGpuDevice } from "femgx/platform";',
      "declare const canvas: HTMLCanvasElement;",
      "declare const viewportContainer: HTMLElement;",
      "const geometry = {",
      '  primitive: "triangles" as const,',
      "  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),",
      "  indices: new Uint32Array([0, 1, 2]),",
      "  nodePickIds: new Uint32Array([1, 2, 3]),",
      "};",
      "const part = createPart(1, {",
      "  geometries: [geometry],",
      "  nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),",
      '  elements: [{ id: 1, primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }], bodyId: 1 }],',
      '  bodies: [{ id: 1, name: "body", elementIds: [1] }],',
      "});",
      "const typedModel = createElementModel([0, 0, 0, 1, 0, 0, 0, 1, 0], [",
      "  createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),",
      "  createElement(2, LINE_SHAPE, [0, 1]),",
      "  createElement(3, POINT_SHAPE, [2]),",
      "]);",
      "const typedPart = elementPart(2, typedModel);",
      "const mixedScene = createScene()",
      "  .addPart(typedPart)",
      "  .addAssembly({ id: 2, name: 'mixed', placements: [",
      "    { kind: 'part', partId: typedPart.id, transform: identity() },",
      "  ] })",
      "  .withRoot(2)",
      ".build();",
      "const scene = createScene()",
      "  .addPart(part)",
      "  .addAssembly({",
      "    id: 1,",
      '    name: "root",',
      "    placements: [",
      '      { kind: "part", partId: part.id, transform: identity() },',
      '      { kind: "part", partId: part.id, transform: translation(2, 0, 0) },',
      "    ],",
      "  })",
      "  .withRoot(1)",
      ".build();",
      "const customCamera = createCamera();",
      "const runtimeTypeCheck = undefined as unknown as SceneRuntime;",
      "const glbTypeCheck = undefined as unknown as GlbSceneImport;",
      "const platformTypeCheck = undefined as unknown as RequestedWebGpuDevice;",
      'const bodyTarget: InteractionTarget = { kind: "body", instanceId: "1/0", bodyId: 0 };',
      "let interaction = createInteractionState();",
      "const partStyle: StyleOverride = { lineWidthPixels: 2 };",
      "interaction = setPartOverride(interaction, part.id, partStyle);",
      'interaction = setInstanceOverride(interaction, "1/0", { lineWidthPixels: 3 });',
      "interaction = setTargetSelected(interaction, bodyTarget, true);",
      "interaction = setTargetHighlighted(interaction, bodyTarget, true);",
      'const stress = createResultField({ id: "stress", name: "Stress", location: "elemental", shape: "scalar", count: 1, unit: "MPa", values: new Float32Array([1]) });',
      'const displacement = createResultField({ id: "displacement", name: "Displacement", location: "nodal", shape: "vector", count: 3, unit: "mm", values: new Float32Array(9) });',
      "const viewportPromise = createFemViewport({ canvas, scene, orientationGizmo: { container: viewportContainer } });",
      "async function exerciseViewport(viewport: FemViewport): Promise<void> {",
      "  viewport.setCamera(viewport.camera);",
      "  viewport.fitView();",
      "  viewport.resize();",
      "  viewport.setInteraction(interaction);",
      "  viewport.setEdgeDepthTest(true);",
      "  const frustum = boxSelectionFrustum(viewport.camera, { left: 0, top: 0, right: viewport.camera.width, bottom: viewport.camera.height, width: viewport.camera.width, height: viewport.camera.height });",
      "  frustum.far.distance;",
      "  viewport.setPartVisible(part.id, true);",
      "  const runtime = viewport.runtime;",
      "  runtime.getInstanceIds();",
      "  runtime.getOccurrences();",
      "  runtime.getVisibleInstanceIds();",
      "  viewport.setResults({ scalar: { field: stress }, deformation: { field: displacement, scale: 1 } });",
      "  viewport.clearResults();",
      "  await viewport.pick(0, 0);",
      "  const hit = await viewport.pick(0, 0);",
      "  if (hit !== undefined) hit.worldPosition;",
      '  const regionTargets = await viewport.pickRegion({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, "part");',
      "  regionTargets satisfies readonly InteractionTarget[];",
      "  viewport.render();",
      "  viewport.invalidate();",
      "  viewport.stats();",
      "  await viewport.recover();",
      "  viewport.destroy();",
      "}",
      "void viewportPromise.then(exerciseViewport);",
      'const parsed = parseVtk("# vtk DataFile Version 5.0\\nsmoke\\nASCII\\nDATASET UNSTRUCTURED_GRID\\nPOINTS 0 double\\nCELLS 0 0\\nCELL_TYPES 0\\n");',
      "const written = writeVtk(parsed.model);",
      "if (written.length === 0) throw new Error();",
    ].join("\n");
    writeFileSync(join(consumer, "smoke.ts"), smokeTs);
    const rootSmokeTs = [
      'import { createScene, identity } from "femgx";',
      "const scene = createScene().build();",
      "const matrix = identity();",
      "void scene;",
      "void matrix;",
    ].join("\n");
    writeFileSync(join(consumer, "root-smoke.ts"), rootSmokeTs);

    const tsconfigBundler = {
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        lib: ["es2022", "dom"],
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      files: ["smoke.ts"],
    };
    writeFileSync(
      join(consumer, "tsconfig.bundler.json"),
      JSON.stringify(tsconfigBundler, null, 2),
    );

    const tsconfigNode10 = {
      compilerOptions: {
        target: "es2022",
        module: "commonjs",
        moduleResolution: "node10",
        lib: ["es2022", "dom"],
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        ignoreDeprecations: "6.0",
      },
      files: ["root-smoke.ts"],
    };
    writeFileSync(join(consumer, "tsconfig.node10.json"), JSON.stringify(tsconfigNode10, null, 2));

    writeFileSync(join(consumer, "smoke.mts"), smokeTs);
    writeFileSync(join(consumer, "smoke.cts"), smokeTs);
    const tsconfigNodeNext = {
      compilerOptions: {
        target: "es2022",
        module: "nodenext",
        moduleResolution: "nodenext",
        lib: ["es2022", "dom"],
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      files: ["smoke.mts", "smoke.cts"],
    };
    writeFileSync(
      join(consumer, "tsconfig.nodenext.json"),
      JSON.stringify(tsconfigNodeNext, null, 2),
    );

    for (const config of [
      "tsconfig.bundler.json",
      "tsconfig.node10.json",
      "tsconfig.nodenext.json",
    ]) {
      runCommand(tsc, ["-p", join(consumer, config)], consumer);
      console.log(`${config} type-check OK`);
    }

    console.log("Package smoke tests passed.");
  } finally {
    removeSmokeRoot(tmp);
  }
}

function isolatedNpmEnvironment(cache, userConfig) {
  return {
    ...process.env,
    npm_config_cache: cache,
    npm_config_userconfig: userConfig,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_loglevel: "error",
    npm_config_progress: "false",
    npm_config_update_notifier: "false",
  };
}

function checkBundleBudgets(root) {
  const entries = ["femgx", "model", "io", "camera", "runtime", "platform", "io/glb"];
  const forbiddenInCore = ["gltf-transform", "draco", "KHRDraco", "draco_decoder", ".wasm"];
  for (const entry of entries) {
    const file = join(root, "dist", `${entry}.js`);
    const contents = readFileSync(file, "utf8");
    const rawBytes = Buffer.byteLength(contents);
    const gzipBytes = gzipSync(contents, { level: 9 }).byteLength;
    console.log(`${entry}: ${rawBytes} bytes raw, ${gzipBytes} bytes gzip`);
    if (entry !== "io/glb") {
      expect(
        !forbiddenInCore.some((marker) => contents.toLowerCase().includes(marker.toLowerCase())),
        `${entry} bundle includes optional GLB/Draco code`,
      );
    }
    if (entry === "femgx") {
      expect(rawBytes <= 420_000, `root bundle exceeds raw budget: ${rawBytes}`);
      expect(gzipBytes <= 110_000, `root bundle exceeds gzip budget: ${gzipBytes}`);
    }
  }
}

function removeSmokeRoot(root) {
  const expectedParent = tmpdir();
  if (dirname(root) !== expectedParent || !basename(root).startsWith("femgx-smoke-")) {
    throw new Error(`Refusing to remove unexpected package-smoke path ${root}`);
  }
  rmSync(root, { recursive: true, force: true });
}

try {
  main();
} catch (error) {
  console.error(`Package smoke tests failed: ${error.message}`);
  process.exit(1);
}
