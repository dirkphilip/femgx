/** @type {import("dependency-cruiser").IConfiguration} */

export default {
  forbidden: [
    {
      name: "no-angular-runtime-cycles",
      severity: "error",
      comment: "Resolve Angular ownership cycles at the semantic owner.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-angular-state-outward-imports",
      severity: "error",
      comment: "Semantic state does not depend on features, effects, or the app shell.",
      from: { path: "^demo/angular/src/state/" },
      to: { path: "^demo/angular/src/(?!state/)" },
    },
    {
      name: "no-angular-effect-to-feature-imports",
      severity: "error",
      comment: "Effects point toward state and package boundaries, never UI features.",
      from: { path: "^demo/angular/src/effects/" },
      to: { path: "^demo/angular/src/(?:app|features)/" },
    },
    {
      name: "no-angular-feature-to-app-imports",
      severity: "error",
      comment: "Features consume state/effects through their facade, not the composition root.",
      from: { path: "^demo/angular/src/features/" },
      to: { path: "^demo/angular/src/app/" },
    },
  ],
  options: {
    includeOnly: ["^demo/angular/src/"],
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "^node_modules/" },
  },
};
