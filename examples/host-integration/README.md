# Host FE integration with dense internal ordinals

This browser example is the complete application-side handoff for a host that
owns sparse or string FE identities. It maps node ids to dense ordinals once,
retains the reverse ordinal-to-host-id table, and then uses only public package
entry points.

The example demonstrates:

- chunked `FemModel` construction and typed validation diagnostics;
- one `Float64Array` interchange table converted once to dense `Float32Array`
  render coordinates;
- validated body ownership without rebuilding the element model;
- one reusable part placed twice through an assembly;
- shared and occurrence-specific scalar and deformation snapshots;
- body hover/click/box selection, sectioning, and pick-to-host result inspection;
- explicit interaction and viewport teardown.

Install FemGx and a browser development server in a small application, copy
this directory, then serve it. For a repository checkout:

```sh
npm ci
npx vite examples/host-integration
```

The package smoke test compiles `host-model.ts` and `main.ts` from a clean
consumer project against the packed public entry points. No example code is
included in the package or imported by production source.
