# Demo fixture requirements

This note is the authoritative contract for finite-element fixtures used by
the demo, the visual inspection workbench, and the opt-in WebGPU performance
lane. A fixture is evidence about the product path only when its authored
topology, retained identities, and reported costs remain truthful. The
migration of existing large benchmark fixtures is tracked in [issue #526](https://github.com/dirkphilip/femgx/issues/526); this contract applies while
that work is in progress and after it is complete.

## Normative contract

Compliant fixtures:

1. Use genuine supported **Triangle**, **Quad**, **Tet**, **Wedge**, **Pyramid**, and **Hex** finite
   elements. Their supported quadratic variants — **Tri6**, **Quad8**,
   **Tet10**, and **Hex20** — are valid fixtures too. A family may be surfaced
   as a shell or a solid, but the authored element records remain real.
2. Do not use an aggregate shortcut. One element must not cover a complete
   grid, part, or body.
3. Assign every rendered primitive to exactly one stable logical element. The
   ownership must survive tessellation, runtime compilation, picking, and
   inspection.
4. Give adjacent elements shared authored node identities. Coincident copied
   coordinates are not a substitute for shared connectivity.
5. Provide truthful faces and bodies whenever the fixture measures or
   demonstrates interaction. Do not collapse interaction-bearing topology
   into a synthetic face or body.
6. A source `ElementModel` may be discarded after a canonical retained `Part`
   is created, but only when the retained part preserves truthful element,
   face, body, and node identities for every supported interaction path.
7. Keep these counts distinct: authored logical elements, unique tessellated
   triangles, and submitted triangle occurrences. Instancing can increase
   submitted occurrences without increasing reusable geometry.
8. Make the costs visible separately where the lane measures them: model
   build, element tessellation, runtime compilation, retained model data,
   initial upload, visible rendering, and picking. A triangle total is not a
   substitute for these costs; unavailable measurements must be identified as
   unavailable.
9. Keep million-scale fixtures lazy or opt-in. Ordinary demo startup and the
   default unit suite must not construct them.
10. Protect the topology contract with structural tests. A regression that
    replaces per-element topology with one aggregate element must fail before
    it can be presented as performance or interaction evidence.

## Count semantics

- **Elements** are the stable logical records authored by the fixture. They
  are not the number of draw calls or the number of triangles after
  tessellation.
- **Unique triangles** are the reusable tessellated triangles stored by the
  part geometry. Shared topology may reduce this count relative to blindly
  duplicating every face.
- **Submitted triangles** are triangle occurrences sent through visible
  instance draws. They include placement/instance multiplicity and therefore
  can be much larger than the unique geometry count.

Triangle and Quad are surface families: each element owns its surface faces,
with quadratic variants retaining authored mid-edge nodes for deterministic
linear tessellation. Tet and Hex are volume families: the fixture authors
volume connectivity and exposes only the intended exterior or explicit faces
for rendering and interaction. Hex8/Hex20 structured solids must therefore
show a real shared-node volume mesh rather than a single surface-covering
record.

The minimum compliant count examples are:

| Fixture                       |         Authored elements | Unique triangles | Submitted triangles |
| ----------------------------- | ------------------------: | ---------------: | ------------------: |
| compliant: Triangle grid      | 999,698 Triangle elements |          999,698 |             999,698 |
| compliant: Quad grid          |     499,849 Quad elements |          999,698 |             999,698 |
| non-compliant: aggregate grid |       1 aggregate element |          999,698 |             999,698 |

The non-compliant row is deliberately an anti-example: equal triangle totals
do not make an aggregate element equivalent to a real element mesh. It loses
the topology and interaction evidence the demo is required to preserve.

## Fixture ownership and execution

The visual workbench and the benchmark lane may share deterministic fixture
factories, but neither may create a parallel scene representation. Fixtures
enter the normal `Scene` → `Viewport` → occurrence-inspection path. Large cases are
selected explicitly and built lazily; they are not part of ordinary startup,
default screenshots, or default unit-test setup.

Until [issue #526](https://github.com/dirkphilip/femgx/issues/526) is complete,
any legacy aggregate large-model case is a migration gap to be removed, not an
approved performance fixture or a benchmark baseline. After the migration,
this note remains the durable contract for new and modified demo fixtures.

[requirements/index|Requirements index]: index.md
