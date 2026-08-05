# FE fixture

The deterministic procedural FE fixtures generate CPU-only, WebGPU-independent
models for the demo and unit tests.

## Element gallery (`createElementFixture`)

`src/fixture/element-fixture.ts` builds a gallery of linear and quadratic
elements for the renderer: one reusable part per family/render-mode pair, with a
root assembly that places the three volume blocks plus a point/line block along
X. The model builders live in `src/fixture/element-models.ts`. Part ids:

- hex: `solid` 1, `surface` 2 (Hex20), `edges` 3
- tet: `solid` 4 (Tet10), `surface` 5, `edges` 6
- `points` 7, `lines` 8 (always visible as overlays)

Tuning knobs are `gridSize` (default `2`, hex cells per axis) and `cellSize`
(default `1`). `modePartIds` maps the volume modes (`solid`, `surface`,
`edges`) to their parts; `visiblePartIdsFor(fixture, mode)` returns the parts
shown for a mode. See [[rendering/element-rendering|Element rendering]].

## Deck panel (`createPanelFixture`)

The original panel fixture (`src/fixture/panel.ts`) generates a stiffened deck
panel model.

### Parameters

- `cellSize` (default `1`) — shell element size in model units (meters).
- `cellsX` (default `4`) — shell elements along X.
- `cellsY` (default `3`) — shell elements along Y.
- `stiffenerHeight` (default `0.5`) — rib height above the deck.

## Topology

Three reusable parts with stable ids:

- `shell` (id `1`) — unit `1 x 1` quad plate in the XY plane.
- `stiffenerX` (id `2`) — unit vertical rib along X (z from 0 to 1).
- `stiffenerY` (id `3`) — unit vertical rib along Y (z from 0 to 1).

Nested assemblies:

- `root` (id `1`) contains one row sub-assembly per shell row plus two stiffener assemblies.
- `row-<i>` (ids `2 .. cellsY + 1`) places `cellsX` shells, each translated along X; the row
  placement carries the Y offset so row `i` sits at `y = i * cellSize`.
- `stiffeners-x` (id `cellsY + 2`) places `cellsY + 1` ribs scaled to the full deck width.
- `stiffeners-y` (id `cellsY + 3`) places `cellsX + 1` ribs scaled to the full deck depth.

## Expected dimensions and counts

- Width `cellsX * cellSize`, depth `cellsY * cellSize`, height `stiffenerHeight`.
- Default instance count: `cellsX * cellsY + (cellsY + 1) + (cellsX + 1)` = 21 for the defaults
  (12 shells, 4 X-stiffeners, 5 Y-stiffeners over a `4 x 3` m footprint).
- Instance ids are deterministic and readable, e.g. `"1/0/0"` is the first shell of the first row.

## Why deterministic

Part and assembly ids are fixed constants, there is no randomness, and the scene is a pure
function of the options. That gives stable instance ids, lets CPU tests assert the exact
structure, and lets e2e assert the exact status text without flakiness. The demo status bar
depends on the default parameters; changing the defaults must update the e2e assertion in
`e2e/demo.spec.ts`.
