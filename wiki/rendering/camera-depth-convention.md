# Camera depth convention

The camera projection maps depth to **`[0, 1]`** to match WebGPU's clip space:
a point at the near plane gets `clip.z = 0` and a point at the far plane gets
`clip.z = w`. This convention is the single source of truth for every consumer:

- `src/camera/camera.ts` `projectionMatrix` (perspective and orthographic).
- `src/camera/project-polygon.ts` `projectPolygon`, which clips a world-space
  polygon against the six clip-space planes (near plane first, so no vertex
  with `w <= 0` survives into the later passes) and projects it to screen
  points. This keeps geometry-anchored screen projections valid when a polygon
  straddles the camera plane instead of dropping it whole.

## History (issue #73)

The projection matrix previously used the OpenGL `[-1, 1]` depth mapping while
WebGPU clips at `[0, 1]`. Consequences that are now fixed:

- WebGPU clipped every triangle closer than `2 * near` (the effective `clip.z = 0`
  point of a `[-1, 1]` matrix), making geometry pop in/out when orbiting close
  to the camera.
- Screen-space polygon projection previously dropped a whole polygon when any
  vertex had `clip.w <= 0`; it now clips the polygon against the camera plane.

The depth convention is exercised by regression tests in `test/camera/` and
`test/camera/project-polygon.test.ts`.

Perspective zoom and orbit are bounds-aware when driven through the installed
camera controls. Empty-space anchors and target-centered transitions admit the largest
requested prefix that keeps every scene-bounds corner in front of the camera.
When GPU picking supplies a displayed world point, cursor-centered zoom uses
that point as the local approach limit and protects every transformed placed-part
bound independently. This allows the camera through empty space inside the union
AABB without allowing another displayed occurrence to cross the camera plane.
The accepted camera still derives a finite clip interval from positive scene
depths, with the near plane no farther than the displayed point. A point or
protected occurrence is never accepted at or behind its scale-aware safety margin.
Off-center-pivot orbit continues to use the whole-AABB admission because it
changes the view direction and can expose a different surface.

Low-level camera zoom and orbit remain pure framing operations; they do not
couple eye distance, orthographic screen scale, or clip values to scene bounds
unless the controls explicitly supply them. This keeps standalone camera math
independent of the current depth range.

Explicit fitting has a separate responsibility: `fitCamera` derives the pose
and clip interval from the current bounds and orientation, with a small finite
depth margin. It does not retain near/far values or eye distance from a prior
scene, and repeated fitting of unchanged inputs is idempotent.
