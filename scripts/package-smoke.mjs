import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
    expect(tarballFiles.includes("dist/femgx.js"), "missing dist/femgx.js in tarball");
    expect(tarballFiles.includes("dist/femgx.umd.cjs"), "missing dist/femgx.umd.cjs in tarball");
    expect(tarballFiles.includes("dist/index.d.ts"), "missing dist/index.d.ts in tarball");
    expect(
      tarballFiles.includes("dist/cjs/index.d.cts"),
      "missing dist/cjs/index.d.cts in tarball",
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
        path.startsWith(".supervisor/") ||
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
      attwOutput = runCommand(attw, [tarball, "--no-color", "--no-emoji"], repoRoot, env).stdout;
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
    expect(
      installedPkg.exports["."].import.types === "./dist/index.d.ts",
      "import types condition is wrong",
    );
    expect(
      installedPkg.exports["."].require.types === "./dist/cjs/index.d.cts",
      "require types condition is wrong",
    );
    expect(
      !existsSync(join(consumerNodeModules, "node_modules")),
      "published package pulled in unexpected dependencies",
    );

    // 6. ESM import at runtime.
    writeFileSync(
      join(consumer, "smoke.mjs"),
      [
        'import { createCamera, createScene, identity } from "femgx";',
        "const scene = createScene();",
        "const camera = createCamera();",
        "const m = identity();",
        'if (m.length !== 16) throw new Error("identity() is not a 4x4 matrix");',
        'console.log("ESM import OK");',
      ].join("\n"),
    );
    console.log(runCommand("node", ["smoke.mjs"], consumer).stdout.trim());

    // 7. CommonJS require at runtime.
    writeFileSync(
      join(consumer, "smoke.cjs"),
      [
        'const { createCamera, createScene, identity } = require("femgx");',
        "const scene = createScene();",
        "const camera = createCamera();",
        'if (identity().length !== 16) throw new Error("identity() is not a 4x4 matrix");',
        'console.log("CJS require OK");',
      ].join("\n"),
    );
    console.log(runCommand("node", ["smoke.cjs"], consumer).stdout.trim());

    // 8. Type-level consumption under each supported moduleResolution.
    const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
    const smokeTs = [
      'import { createElement, createElementModel, createFemViewport, createInteractionState, createPart, createResultField, createScene, heterogeneousElementParts, identity, LINE_SHAPE, POINT_SHAPE, TRIANGLE_SHAPE, parseVtk, setTargetHighlighted, setTargetSelected, translation, writeVtk, type FemViewport, type InteractionTarget } from "femgx";',
      "declare const canvas: HTMLCanvasElement;",
      "const geometry = {",
      '  primitive: "triangles" as const,',
      "  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),",
      "  indices: new Uint32Array([0, 1, 2]),",
      "  nodePickIds: new Uint32Array([1, 2, 3]),",
      "  nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),",
      "  elements: [{ id: 0, primitiveStart: 0, primitiveCount: 1, bodyId: 0 }],",
      '  bodies: [{ id: 0, name: "body", elementIds: [0] }],',
      "};",
      "const part = createPart(1, geometry);",
      "const typedModel = createElementModel([0, 0, 0, 1, 0, 0, 0, 1, 0], [",
      "  createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),",
      "  createElement(2, LINE_SHAPE, [0, 1]),",
      "  createElement(3, POINT_SHAPE, [2]),",
      "]);",
      "const typedParts = heterogeneousElementParts({ triangle: 2, line: 3, point: 4 }, typedModel);",
      "const typedTriangle = typedParts.triangle;",
      "const typedLine = typedParts.line;",
      "const typedPoint = typedParts.point;",
      "if (typedTriangle === undefined || typedLine === undefined || typedPoint === undefined) throw new Error('mixed typed model lost a primitive group');",
      "const mixedScene = createScene()",
      "  .addPart(typedTriangle)",
      "  .addPart(typedLine)",
      "  .addPart(typedPoint)",
      "  .addAssembly({ id: 2, name: 'mixed', placements: [",
      "    { kind: 'part', partId: typedTriangle.id, transform: identity() },",
      "    { kind: 'part', partId: typedLine.id, transform: identity() },",
      "    { kind: 'part', partId: typedPoint.id, transform: identity() },",
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
      'const bodyTarget: InteractionTarget = { kind: "body", instanceId: "1/0", bodyId: 0 };',
      "let interaction = createInteractionState();",
      "interaction = setTargetSelected(interaction, bodyTarget, true);",
      "interaction = setTargetHighlighted(interaction, bodyTarget, true);",
      'const stress = createResultField({ id: "stress", name: "Stress", location: "elemental", shape: "scalar", count: 1, unit: "MPa", values: new Float32Array([1]) });',
      'const displacement = createResultField({ id: "displacement", name: "Displacement", location: "nodal", shape: "vector", count: 3, unit: "mm", values: new Float32Array(9) });',
      "const viewportPromise = createFemViewport({ canvas, scene });",
      "async function exerciseViewport(viewport: FemViewport): Promise<void> {",
      "  viewport.setCamera(viewport.camera);",
      "  viewport.fitView();",
      "  viewport.resize();",
      "  viewport.setInteraction(interaction);",
      "  viewport.setEdgeDepthTest(true);",
      "  viewport.setNodeOverlay(true);",
      "  viewport.setPartVisible(part.id, true);",
      "  const runtime = viewport.runtime;",
      "  runtime.getInstanceIds();",
      "  runtime.getNodes();",
      "  runtime.getDrawList();",
      "  viewport.setResults({ field: stress, deformation: { field: displacement, scale: 1 } });",
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
      files: ["smoke.ts"],
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
