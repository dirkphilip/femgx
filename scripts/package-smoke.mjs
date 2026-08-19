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

    console.log("Running Publint package metadata validation...");
    runCommand(
      join(repoRoot, "node_modules", ".bin", "publint"),
      ["run", "--strict", "--pack=false"],
      repoRoot,
      env,
    );

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
    const publicEntries = [
      "model",
      "io",
      "io/glb",
      "camera",
      "interaction",
      "results",
      "runtime",
      "platform",
    ];
    const expectedArtifacts = [
      "dist/femgx.js",
      "dist/entries/root.d.ts",
      ...publicEntries.flatMap((entry) => [`dist/${entry}.js`, `dist/entries/${entry}.d.ts`]),
    ];
    for (const artifact of expectedArtifacts) {
      expect(tarballFiles.includes(artifact), `missing ${artifact} in tarball`);
    }
    expect(
      !tarballFiles.some(
        (path) => path.startsWith("dist/cjs/") || path.endsWith(".cjs") || path.endsWith(".d.cts"),
      ),
      "tarball includes obsolete CommonJS artifacts",
    );
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

    // 4. Validate the ESM declarations and exports map with @arethetypeswrong/cli.
    console.log("Running @arethetypeswrong/cli on the packed tarball...");
    const attw = join(repoRoot, "node_modules", ".bin", "attw");
    let attwOutput;
    try {
      attwOutput = runCommand(
        attw,
        [
          tarball,
          "--no-color",
          "--no-emoji",
          "--ignore-rules",
          "cjs-resolves-to-esm",
          "no-resolution",
        ],
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
      ".": "dist/entries/root.d.ts",
      ...Object.fromEntries(
        publicEntries.map((entry) => [`./${entry}`, `dist/entries/${entry}.d.ts`]),
      ),
    };
    expect(
      Object.keys(installedPkg.exports).sort().join(",") ===
        [...Object.keys(expectedExports), "./package.json"].sort().join(","),
      "package exports contain an undeclared or missing entry",
    );
    for (const [entry, types] of Object.entries(expectedExports)) {
      expect(
        installedPkg.exports[entry]?.types === `./${types}`,
        `${entry} types condition is wrong`,
      );
      expect(!("require" in installedPkg.exports[entry]), `${entry} must not expose CommonJS`);
    }
    expect(
      !existsSync(join(consumerNodeModules, "node_modules")),
      "published package pulled in unexpected dependencies",
    );

    // 6. ESM import at runtime.
    writeFileSync(
      join(consumer, "smoke.mjs"),
      [
        'import { createScene, identity } from "femgx";',
        'import { createCamera } from "femgx/camera";',
        'import { boxSelectionFrustum, createInteractionState, setPartOccurrenceOverride, setPartOccurrenceOverrides, setPartOverride } from "femgx/interaction";',
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
        'if (typeof setPartOverride !== "function" || typeof setPartOccurrenceOverride !== "function" || typeof setPartOccurrenceOverrides !== "function") throw new Error("part-occurrence override exports failed");',
        "let interaction = createInteractionState();",
        "interaction = setPartOverride(interaction, 1, { lineWidthPixels: 2 });",
        'interaction = setPartOccurrenceOverride(interaction, "1/0", { lineWidthPixels: 3 });',
        'interaction = setPartOccurrenceOverrides(interaction, [["1/0", { emissive: 0.2 }]]);',
        'if (typeof model.createElementModel !== "function") throw new Error("model entry failed");',
        "const builder = io.createModelBuilder();",
        "builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);",
        "builder.openElementShapeBlock(model.ElementShape.Triangle);",
        "builder.appendElements([1], [0, 1, 2]);",
        "const femModel = builder.build();",
        'if (io.validateModel(femModel).length !== 0) throw new Error("io validation failed");',
        'if (io.createElementModelFromFemModel(femModel).elements.length !== 1) throw new Error("io conversion failed");',
        'if (typeof io.createResultFieldFromModelResult !== "function") throw new Error("io result conversion failed");',
        'if (typeof glb.importGlb !== "function") throw new Error("GLB entry failed");',
        'if (typeof runtime.createSceneRuntime !== "function") throw new Error("runtime entry failed");',
        'if (typeof platform.queryWebGpuSupport !== "function") throw new Error("platform entry failed");',
        'console.log("ESM import OK");',
      ].join("\n"),
    );
    console.log(runCommand("node", ["smoke.mjs"], consumer).stdout.trim());

    // 7. Type-level consumption under each supported ESM module resolution.
    const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
    const tsc5 = join(repoRoot, "node_modules", "typescript-5", "bin", "tsc");
    const smokeTs = [
      'import { createViewport, createPart, createScene, identity, translation, UnknownSceneIdentityError, type Viewport } from "femgx";',
      'import { boxSelectionFrustum, createInteractionState, setPartOccurrenceOverride, setPartOccurrenceOverrides, setPartOverride, setTargetHighlighted, setTargetSelected, type InteractionTarget, type StyleOverride } from "femgx/interaction";',
      'import { createResultField } from "femgx/results";',
      'import { createElement, createElementModel, elementPart, ElementShape } from "femgx/model";',
      'import { createElementModelFromFemModel, createModelBuilder, createResultFieldFromModelResult, validateModel } from "femgx/io";',
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
      "  createElement(1, ElementShape.Triangle, [0, 1, 2]),",
      "  createElement(2, ElementShape.Line, [0, 1]),",
      "  createElement(3, ElementShape.Point, [2]),",
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
      'const bodyTarget: InteractionTarget = { kind: "body", partOccurrenceId: "1/0", bodyId: 0 };',
      "let interaction = createInteractionState();",
      "const partStyle: StyleOverride = { lineWidthPixels: 2 };",
      "interaction = setPartOverride(interaction, part.id, partStyle);",
      'interaction = setPartOccurrenceOverride(interaction, "1/0", { lineWidthPixels: 3 });',
      'interaction = setPartOccurrenceOverrides(interaction, [["1/0", { emissive: 0.2 }]]);',
      "interaction = setTargetSelected(interaction, bodyTarget, true);",
      "interaction = setTargetHighlighted(interaction, bodyTarget, true);",
      'const stress = createResultField({ id: "stress", name: "Stress", location: "elemental", shape: "scalar", count: 1, unit: "MPa", values: new Float32Array([1]) });',
      'const displacement = createResultField({ id: "displacement", name: "Displacement", location: "nodal", shape: "vector", count: 3, unit: "mm", values: new Float32Array(9) });',
      "const viewportPromise = createViewport({ canvas, scene, orientationGizmo: { container: viewportContainer } });",
      "async function exerciseViewport(viewport: Viewport): Promise<void> {",
      "  viewport.view.setCamera(viewport.view.camera);",
      "  viewport.view.fit();",
      "  viewport.resize();",
      "  viewport.interaction.set(interaction);",
      "  viewport.presentation.setEdgeDepthTest(true);",
      "  const frustum = boxSelectionFrustum(viewport.view.camera, { left: 0, top: 0, right: viewport.view.camera.width, bottom: viewport.view.camera.height, width: viewport.view.camera.width, height: viewport.view.camera.height });",
      "  frustum.far.distance;",
      "  viewport.visibility.setPart(part.id, true);",
      "  const runtime = viewport.runtime;",
      "  runtime.getPartOccurrenceIds();",
      "  runtime.getOccurrences();",
      "  runtime.getVisiblePartOccurrenceIds();",
      "  viewport.results.set({ scalar: { field: stress }, deformation: { field: displacement, scale: 1 } });",
      "  viewport.results.clear();",
      "  await viewport.interaction.pick(0, 0);",
      "  const hit = await viewport.interaction.pick(0, 0);",
      "  if (hit !== undefined) hit.worldPosition;",
      '  const regionTargets = await viewport.interaction.pickRegion({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, "part");',
      "  regionTargets satisfies readonly InteractionTarget[];",
      "  viewport.render();",
      "  viewport.invalidate();",
      "  viewport.stats();",
      "  await viewport.recover();",
      "  viewport.destroy();",
      "}",
      "void UnknownSceneIdentityError;",
      "void viewportPromise.then(exerciseViewport);",
      "const ioBuilder = createModelBuilder();",
      "ioBuilder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);",
      "ioBuilder.openElementShapeBlock(ElementShape.Triangle);",
      "ioBuilder.appendElements([1], [0, 1, 2]);",
      'ioBuilder.addResult({ name: "stress", location: "element", components: 1, ids: new Uint32Array([1]), values: new Float64Array([1]) });',
      "const ioModel = ioBuilder.build();",
      "if (validateModel(ioModel).length !== 0) throw new Error();",
      "const ioElementModel = createElementModelFromFemModel(ioModel);",
      "if (ioElementModel.elements.length !== 1) throw new Error();",
      "const ioResult = ioModel.results[0];",
      'if (ioResult === undefined) throw new Error("missing smoke result");',
      'const ioField = createResultFieldFromModelResult(ioModel, ioResult, { id: "stress", unit: "MPa", shape: "scalar" });',
      "if (ioField.values[0] !== 1) throw new Error();",
    ].join("\n");
    writeFileSync(join(consumer, "smoke.ts"), smokeTs);
    const hostExampleFiles = ["host-model.ts", "main.ts"];
    for (const file of hostExampleFiles) {
      writeFileSync(
        join(consumer, file),
        readFileSync(join(repoRoot, "examples", "host-integration", file), "utf8"),
      );
    }
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
      files: ["smoke.ts", ...hostExampleFiles],
    };
    writeFileSync(
      join(consumer, "tsconfig.bundler.json"),
      JSON.stringify(tsconfigBundler, null, 2),
    );

    const tsconfigTypeScript5 = {
      compilerOptions: {
        ...tsconfigBundler.compilerOptions,
        types: ["@webgpu/types"],
      },
      files: ["smoke.ts", ...hostExampleFiles],
    };
    writeFileSync(
      join(consumer, "tsconfig.typescript5.json"),
      JSON.stringify(tsconfigTypeScript5, null, 2),
    );

    writeFileSync(join(consumer, "smoke.mts"), smokeTs);
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
      files: ["smoke.mts", ...hostExampleFiles],
    };
    writeFileSync(
      join(consumer, "tsconfig.nodenext.json"),
      JSON.stringify(tsconfigNodeNext, null, 2),
    );

    for (const config of ["tsconfig.bundler.json", "tsconfig.nodenext.json"]) {
      runCommand(tsc, ["-p", join(consumer, config)], consumer);
      console.log(`${config} type-check OK`);
    }
    runCommand(
      "npm",
      [
        "install",
        join(repoRoot, "node_modules", "@webgpu", "types"),
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--no-save",
        "--offline",
        "--cache",
        installCache,
        "--userconfig",
        userConfig,
      ],
      consumer,
      isolatedNpmEnvironment(installCache, userConfig),
    );
    runCommand(tsc5, ["-p", join(consumer, "tsconfig.typescript5.json")], consumer);
    console.log("tsconfig.typescript5.json type-check OK");

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
      // Keep the raw ceiling below the next bundle-size tier while retaining
      // the stricter compression ceiling and optional-code exclusion checks.
      expect(rawBytes <= 600_000, `root bundle exceeds raw budget: ${rawBytes}`);
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
