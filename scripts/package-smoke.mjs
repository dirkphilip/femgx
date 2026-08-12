import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), "femgx-smoke-"));
  const consumer = join(tmp, "consumer");
  const tarballDir = join(tmp, "pack");
  const consumerNodeModules = join(consumer, "node_modules", "femgx");
  try {
    mkdirSync(tarballDir);
    mkdirSync(consumer);
    // 1. Build the library from source.
    run("npm", ["run", "build"], repoRoot);

    // 2. Pack the publishable tarball.
    console.log("Packing package...");
    const packJson = run("npm", ["pack", "--json", "--pack-destination", tarballDir], repoRoot);
    const packResult = JSON.parse(packJson)[0];
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
      attwOutput = run(attw, [tarball, "--no-color", "--no-emoji"], repoRoot);
    } catch (error) {
      throw new Error(
        `@arethetypeswrong/cli found type-resolution problems:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
      );
    }
    console.log(attwOutput.trim());

    // 5. Install into a clean consumer project (no dev tooling, no registry access).
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "femgx-consumer", private: true, version: "0.0.0", type: "module" }),
    );
    console.log("Installing tarball into clean consumer...");
    run("npm", ["install", tarball, "--no-audit", "--no-fund", "--no-package-lock"], consumer);

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
    console.log(run("node", ["smoke.mjs"], consumer).trim());

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
    console.log(run("node", ["smoke.cjs"], consumer).trim());

    // 8. Type-level consumption under each supported moduleResolution.
    const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
    const smokeTs = [
      'import { createFemViewport, createInteractionState, createPart, createResultField, createScene, identity, parseVtk, setTargetHighlighted, setTargetSelected, translation, writeVtk, type FemViewport, type InteractionTarget } from "femgx";',
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
      '  viewport.setInstanceVisible("1/0", true);',
      '  viewport.setAssemblyNodeVisible("1/0", true);',
      "  viewport.setResults({ field: stress, deformation: { field: displacement, scale: 1 } });",
      "  viewport.clearResults();",
      "  await viewport.pick(0, 0);",
      "  await viewport.pickPoint(0, 0);",
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
      run(tsc, ["-p", join(consumer, config)], consumer);
      console.log(`${config} type-check OK`);
    }

    console.log("Package smoke tests passed.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`Package smoke tests failed: ${error.message}`);
  process.exit(1);
}
