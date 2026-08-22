# Angular workbench policy

This directory is the temporary Angular replacement shell described by
[[../../wiki/architecture/angular-workbench|the Angular workbench contract]].
It is a consumer of published FemGx package facades, not a second rendering
implementation.

## Ownership

- `src/app/` is the composition root and owns provider composition only.
- `src/features/` contains the current visible slice and its narrow facade.
- `src/state/` owns semantic Angular signals and discriminated lifecycle state.
- `src/effects/viewport/` is the only owner allowed to create, recover, hold,
  and destroy a FemGx `Viewport`.
- `fixtures/` is the only repository-private model-data dependency. It must
  continue to consume published `femgx` package APIs.

Keep one concrete owner per long-lived concern. Components may own local view
state and lifecycle hooks, but never WebGPU, scenes, viewport references,
timers, recovery, or renderer internals.

## Imports and composition

Angular production code imports FemGx only as an external consumer would:
`femgx` and `femgx/model`. Never import `src/`, `@/`, renderer modules,
packed-runtime modules, Svelte workbench code, tests, benchmarks, or e2e code.
Only `ViewportCoordinator` may import or hold the FemGx `Viewport` value.

Dependencies point inward:

```text
app → features → state/effects → published femgx facades
```

Do not add a global store, event bus, command registry, controller callback
bag, active-slot forwarding property, compatibility facade, or feature service
for a later roadmap slice. Add a vertical slice only when its issue is active.

## Lifecycle and validation

Use the explicit `idle | starting | ready | unsupported | failed | destroyed`
lifecycle union. Async creation and recovery must be generation-safe; a late
result after destruction must destroy its viewport and must not republish state.
WebGPU failure is presented as typed unsupported/failed state. There is no CPU
renderer fallback.

Keep Angular source and component files under the repository's 400-line and
60-line function ceilings. Add focused architecture fixtures when a rule is
introduced, including accepted and rejected ownership examples.
