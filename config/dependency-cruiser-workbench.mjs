/** @type {import("dependency-cruiser").IConfiguration} */

export default {
  forbidden: [
    {
      name: "no-workbench-runtime-circular-dependencies",
      severity: "error",
      comment:
        "Resolve runtime workbench cycles at their semantic owner; declaration-only imports are not runtime edges.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    includeOnly: ["^demo/workbench/"],
    tsConfig: { fileName: "tsconfig.json" },
    // This pass checks executable ownership only. The main source pass retains
    // TypeScript pre-compilation dependency analysis for library boundaries.
    tsPreCompilationDeps: false,
    doNotFollow: { path: "^node_modules/" },
  },
};
