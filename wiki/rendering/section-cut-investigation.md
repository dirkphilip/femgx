# Exact FE section-cut investigation

Issue #719 asked whether the existing one-plane clip could grow exact finite-element
cut surfaces without weakening instancing, identity, or the disabled-cost
contract. Issue #958 approved and delivered that bounded behavior after the
product priority changed. This note records the durable implementation contract
and the evidence that led to it; no new public API or demo-only section manager
is introduced.

## Baseline

`ViewportPresentation.setSectionPlane` clips existing displayed geometry in the fragment
stages and, when active, adds internal generated caps for supported solid FE
occurrences. The validated plane is retained as four floats and written to the
existing section uniform. Opaque, transparent, edge, node, selection,
orientation, and GPU-pick fragments share the same positive-half-space test;
cap triangles use that same world-space rule. The cost contract is:

| State               |                                 New passes/draws/targets/readback |                       CPU geometry work |   Section uniform |
| ------------------- | ----------------------------------------------------------------: | --------------------------------------: | ----------------: |
| Off                 |                                                                 0 |                                       0 | 1 write, 16 bytes |
| On, unchanged frame | existing scene submission plus retained cap draws; no cap rebuild |                             0 cap build | 1 write, 16 bytes |
| On, invalidated     |                1 existing scene submission plus bounded cap draws | active occurrence scan/build and upload | 1 write, 16 bytes |

The active state keeps the existing scene passes and adds only reusable cap
triangle draws; it adds no cap-specific pass, readback, or ordinary instancing
change. Hidden occurrences are absent from both ordinary and cap draw lists. The
write is retained in both states because the current frame contract rewrites all
small uniforms every frame.

## Candidate ownerships

| Candidate                                           | Correctness and identity                                                                                                                                                        | Active work                                                                                                                                                              | Main risk                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical topology on the host                      | `faceRefsOf` supplies oriented authored face loops. Node ids, element/face ownership, body/neighbor metadata, occurrence transforms, and authored deformation remain available. | Scan display-eligible element occurrences, intersect face edges with the plane, stitch each element's segments, triangulate the polygon, and upload/update cut geometry. | A CPU result is straightforward but must be rebuilt for every relevant deformation, transform, visibility, and plane change. It needs bounded reusable buffers and a precise interpolation path for nodal results.         |
| Existing display tessellation on the host           | Reuses `FaceTessellation`, primitive ranges, node-pick ids, and the already deformed display positions.                                                                         | Scan submitted triangles, intersect their edges, deduplicate shared boundaries, stitch segments, and assign the owning element/face.                                     | Tessellation diagonals become observable: one authored face can produce duplicate or split cut segments. The scan is fast, but exact ownership still needs a seam-aware stitcher.                                          |
| Existing display tessellation in a bounded GPU path | Keeps the current instanced draw inputs and can parallelize triangle intersection.                                                                                              | Requires a compute/compaction path or an additional render-to-buffer construction stage, plus dynamic output capacity and a final draw.                                  | WebGPU has no geometry shader. Variable-length per-element polygons, deduplication, triangulation, result interpolation, occurrence identity, visibility, deformation, and recovery all become a second geometry pipeline. |

Neither candidate can treat the cut as a synthetic face or node. A generated
polygon must retain its owning element occurrence and face context while
remaining outside the scene's authored identity and pick-id namespace.

## Prototype measurements

The temporary host prototype used the canonical oriented face loops and the
existing indexed triangle positions. It placed the plane at the local Z-bound
midpoint, counted edge crossings, ran two untimed warmups and five samples of
20 repeated scans, and reports the median scan time on this development machine.
The scan timings are lower bounds: they exclude polygon stitching,
triangulation, buffer growth, upload, and GPU synchronization.

### Shape coverage

The grid-4 fixture exercised all requested solid families. The tessellation
segment count exceeding the canonical count for Tet10, Wedge6, Hex8, and Hex20
is the expected diagonal/seam signal, not a correctness result.

| Shape    | Elements | Canonical faces/edges | Existing triangles | Canonical crossings | Tessellation crossings |
| -------- | -------: | --------------------: | -----------------: | ------------------: | ---------------------: |
| Tet4     |      384 |         1,536 / 4,608 |              1,536 |                 640 |                    640 |
| Tet10    |      384 |         1,536 / 9,216 |              6,144 |                 640 |                  1,280 |
| Wedge6   |        1 |                5 / 18 |                  8 |                   6 |                     12 |
| Pyramid5 |        1 |                5 / 16 |                  6 |                   8 |                      8 |
| Hex8     |       64 |           384 / 1,536 |                768 |                 128 |                    256 |
| Hex20    |       64 |           384 / 3,072 |              2,304 |                 128 |                    448 |

### Section fixture and medium volume

| Workload                     | Elements |  Nodes | Existing triangles | Canonical crossings | Tessellation crossings | Canonical scan | Tessellation scan |
| ---------------------------- | -------: | -----: | -----------------: | ------------------: | ---------------------: | -------------: | ----------------: |
| Section-plane Hex20 cylinder |       72 |    492 |              2,592 |                 192 |                    672 |       0.355 ms |          0.030 ms |
| Hex20 grid-16 medium volume  |    4,096 | 18,785 |            147,456 |               2,048 |                  7,168 |      16.003 ms |          1.591 ms |

The tessellation scan is about 10.1× faster on the medium fixture, but its
7,168 crossing records still need exact seam elimination and ownership
reconstruction. The canonical scan's 16.003 ms already exceeds a 60 Hz frame
budget before construction or upload, so a naïve host rebuild is not suitable
as an always-on interaction path. A bounded host path would need explicit
active-only scheduling and reusable capacity; a GPU path would need the second
geometry pipeline described above.

## Recommendation

**Approve the bounded exact-cap path delivered in #958.** Keep the existing
positive-half-space clip as the visibility rule and build one deterministic
polygon per intersected supported solid element occurrence from canonical
authored face-edge topology. Store the generated polygon as an internal,
occurrence-scoped synthetic draw record; retain the original part/instance and
element ids for interaction resolution, and leave face/node/edge ids absent.

The builder covers Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20, including
active nodal deformation and occurrence transforms. Tangent-only and zero-area
contacts emit no triangles. Nodal result colors interpolate endpoint values;
elemental result colors and all resolved style/visibility layers come from the
owning element. A cap is included in the ordinary four-attachment pick pass and
resolves to its owning element occurrence without fabricating a face, node, or
edge.

The cap state is active-only and invalidation-driven. Section Off performs no cap
scan, allocation, upload, draw, or pick work. An unchanged active frame reuses
the retained cap parts and buffers. Plane, scene/runtime transform, visibility,
interaction, result, deformation, and device-recovery changes rebuild from
authoritative state; recovery retains the plane and rebuilds the active records.
Multiple planes, CSG, hatching, slice export, CAD/GLB capping, and generalized
geometry queries remain explicitly out of scope.

The existing real-Chrome controls continue to exercise the supported
section-volume preset. CPU goldens cover topology/winding/interpolation and
renderer tests cover active-only resource reuse, picking ownership, invalidation,
and recovery.
