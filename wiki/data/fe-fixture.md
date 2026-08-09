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

## Portal frame (`createFrameFixture`)

`src/fixture/frame-fixture.ts` generates a structural portal frame with
conforming hex topology: columns, a beam, and a brace network, each modeled
with real finite elements (not a single panel). Three reusable parts (`solid`,
`surface`, `edges`) let the volume render modes switch by part visibility. The
frame is the workbench preset that best exercises element/face picking because
its faces are large and unambiguous (see
[[rendering/fe-inspection-workbench|FE inspection workbench]]).

## Bolted plate assembly (`createBoltedPlateFixture`)

`src/fixture/bolted-plate.ts` (meshes in `bolted-plate-mesh.ts`) builds the
demo's default showcase: a bolted lap joint of two overlapping plates clamped
by a grid of fasteners. It is the reference example of the canonical
hierarchical assembly model and GPU instancing: every fastener reuses the same
bolt, washer, and nut part definitions through nested assemblies.

### Parameters

- `plateLength` (default `30`) — plate length along X.
- `plateWidth` (default `14`) — plate width along Z.
- `plateThickness` (default `2`) — plate thickness along Y.
- `overlapOffset` (default `6`) — X offset of the upper plate, leaving the
  overlap zone that hosts the fasteners.

### Topology

Four reusable components, each tessellated for the three volume modes (so 12
parts total):

- `plate` (solid 1, surface 2, edges 3) — a shared 30 x 14 x 2 m steel plate,
  placed twice (lower + upper).
- `bolt` (4, 5, 6) — an 0.8 m shaft under a 1.4 x 1.4 m square head.
- `washer` (7, 8, 9) — a thin 1.4 x 1.4 m slab, placed twice per fastener.
- `nut` (10, 11, 12) — a 1.5 x 1.5 m box on the shaft end.

Nested assemblies (19 total):

```text
Bolted joint (1)
├── Plate stack (2)          places the shared plate part twice
└── Fasteners (3)
    └── Fastener 1..8 (4..11)  at 2 rows x 4 columns
        ├── Bolt               solid/surface/edges placements
        ├── Washers (12..19)   top + bottom placements
        └── Nut                solid/surface/edges placements
```

### Expected dimensions and counts

- Default instance count is 102 (all mode parts placed), of which 34 are
  visible per volume mode: 2 plates + 8 fasteners x (1 bolt + 2 washers + 1 nut).
- Bounds span X `-15..21`, Y `-4..4.35` (fasteners protrude beyond the 2 m plate
  stack), Z `-7..7`; the isometric default camera frames this box.
- Instance ids are deterministic and readable, e.g. `"1/1/0/3/0"` is the top
  washer (solid) of fastener 1.

The exterior washer, bolt-head, and nut faces are separated by a fixed `0.05 m`
clearance derived from the plate thickness. This keeps the fixture visually
unambiguous and avoids coplanar surfaces in the renderer showcase.

The bolted preset is the demo's default (`createDefaultPreset`), so e2e
assertions about the landing view and status line depend on these defaults;
changing them must update `e2e/demo.spec.ts`.

## Why deterministic

Part and assembly ids are fixed constants, there is no randomness, and the scene is a pure
function of the options. That gives stable instance ids, lets CPU tests assert the exact
structure, and lets e2e assert the exact status text without flakiness. The demo status bar
depends on the default parameters; changing the defaults must update the e2e assertions in
`e2e/demo.spec.ts`.
