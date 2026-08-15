# Exact FE section-cut investigation

Issue #719 asked whether the existing one-plane clip could grow exact finite-element
cut surfaces without weakening instancing, identity, or the disabled-cost
contract. This note records the investigation result. No production source,
public API, demo control, or product-scope change is part of this decision.

## Baseline

`FemViewport.setSectionPlane` currently clips the existing displayed geometry in
the fragment stages. The validated plane is retained as four floats and written
to the existing section uniform. Opaque, transparent, edge, node, selection,
orientation, and GPU-pick fragments share the same positive-half-space test.
The current path therefore has these measured cost properties:

| State | New passes/draws/targets/readback | CPU geometry work |   Section uniform |
| ----- | --------------------------------: | ----------------: | ----------------: |
| Off   |                                 0 |                 0 | 1 write, 16 bytes |
| On    |                                 0 |                 0 | 1 write, 16 bytes |

The active state adds the fragment predicate to the existing scene passes; it
does not add a pass, allocation, or readback. Its only existing upload is the
same 16-byte section-uniform write shown in the table. Hidden occurrences are
already absent from the draw lists, so the clip predicate does not visit them.
The write is retained in both states because the current frame contract rewrites
all small uniforms every frame.

## Candidate ownerships

| Candidate                                           | Correctness and identity                                                                                                                                                            | Active work                                                                                                                                                              | Main risk                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical topology on the host                      | `facesOfElement` supplies oriented authored face loops. Node ids, element/face ownership, body/neighbor metadata, occurrence transforms, and authored deformation remain available. | Scan display-eligible element occurrences, intersect face edges with the plane, stitch each element's segments, triangulate the polygon, and upload/update cut geometry. | A CPU result is straightforward but must be rebuilt for every relevant deformation, transform, visibility, and plane change. It needs bounded reusable buffers and a precise interpolation path for nodal results.         |
| Existing display tessellation on the host           | Reuses `FaceTessellation`, primitive ranges, node-pick ids, and the already deformed display positions.                                                                             | Scan submitted triangles, intersect their edges, deduplicate shared boundaries, stitch segments, and assign the owning element/face.                                     | Tessellation diagonals become observable: one authored face can produce duplicate or split cut segments. The scan is fast, but exact ownership still needs a seam-aware stitcher.                                          |
| Existing display tessellation in a bounded GPU path | Keeps the current instanced draw inputs and can parallelize triangle intersection.                                                                                                  | Requires a compute/compaction path or an additional render-to-buffer construction stage, plus dynamic output capacity and a final draw.                                  | WebGPU has no geometry shader. Variable-length per-element polygons, deduplication, triangulation, result interpolation, occurrence identity, visibility, deformation, and recovery all become a second geometry pipeline. |

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

**Defer exact FE section-cut surfaces.** Keep the current clip-only plane as the
supported behavior and do not open an implementation issue yet. It preserves
the current disabled-cost contract, instancing, occurrence-scoped identity,
deformation, results, and picking with no new owner or resource family.

If product priority changes, open a separate implementation issue only after
the product-scope contract is updated. That issue should require, at minimum:

- an active-only bounded capacity model for output polygons and uploads;
- explicit face/element ownership and no fabricated interaction identities;
- consistent occurrence transforms, authored nodal deformation, scalar result
  interpolation, body/visibility/section state, and recovery invalidation;
- Tet4/Tet10, Wedge6, Pyramid5, Hex8, and Hex20 seam and winding tests;
- disabled and active measurements that include construction, upload, and the
  real WebGPU frame, not only the lower-bound scans reported here.

The existing real-Chrome section-clipping coverage remains valid for the
current contract; this investigation intentionally adds no exact-cut behavior.
