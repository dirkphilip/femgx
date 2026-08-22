# Angular workbench

The Angular workbench is a guarded replacement shell for the current Svelte
inspection demo. It is temporary migration machinery: both shells may be
published during migration, but Angular becomes the canonical Pages entry only
after the retained capability matrix in the roadmap is complete.

## Gate 0 ownership

The first slice is deliberately one fixed repository-owned Tet4 scene rendered
through one public `Viewport`. Its physical ownership is:

```text
demo/angular/
  src/app/                 composition root and providers
  src/features/viewer/     visible shell and narrow viewer facade
  src/state/                semantic signal state and lifecycle union
  src/effects/viewport/     sole Viewport lifecycle owner
```

The component owns only view-local DOM and lifecycle hooks. The feature facade
owns the visible slice's actions and presentation projection. The application
state owns the synchronous semantic lifecycle signal. The viewport coordinator
owns the asynchronous FemGx `Viewport`, canvas attachment, recovery routing,
generation cancellation, and destruction.

There is one authoritative `Scene` for this slice, created by the fixed
`fixtures/fe/tet4` owner. Angular does not create geometry, compile runtimes,
or implement rendering semantics.

## Dependency direction

```text
Angular component → narrow feature facade → state/effects → published femgx
                                                   ↑
                                      repository-private fixed fixture
```

Production Angular imports use the same package specifiers as an external host:
`femgx` and `femgx/model`. Vite and TypeScript resolve those specifiers to the
local package entries for repository development. No Angular module may import
`src/`, `@/`, renderer or packed-runtime internals, Svelte workbench code,
tests, benchmarks, or e2e helpers. Only the viewport coordinator may import or
hold a `Viewport` value or call `createViewport`.

The dependency-cruiser configuration and architecture guard test these rules
before feature implementation expands the tree. Runtime cycles are errors.
The custom composition rules from [[architecture/source-organization|source
organization]] are enabled for the Angular tree from its first module.

## Lifecycle contract

Application state is a discriminated union:

```text
idle → starting → ready
                 ├→ failed
                 └→ destroyed
starting → unsupported | failed | destroyed
```

`recover()` uses the same generation boundary as initial creation. If a
component or owner is destroyed while creation or recovery is pending, a late
viewport is immediately destroyed and cannot overwrite `destroyed` state.
`WebGpuUnsupportedError` is presented as `unsupported`; all other failures are
`failed`. The product remains WebGPU-only and has no CPU fallback.

## Migration boundary

This slice does not migrate camera controls, picking, visibility, results,
section planes, secondary slots, placement editing, toolbar behavior, or
mesh-authoring controls. Each retained capability gets a later vertical issue
with its own state/effect/component owner and deletion result. Angular must not
grow placeholder services or compatibility facades for those features.
