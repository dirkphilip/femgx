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

Perspective zoom preserves the configured `near` and `far` clip planes. The
eye-target distance is clamped to `[2 * near, far / 2]`, so deep zoom cannot
ratchet the near plane toward zero and destroy depth precision. Cursor-centered
zoom applies the same distance clamp while scaling the eye and target around
the world-space pivot; ordinary orthographic zoom retains its existing scale
behavior.

Explicit fitting has a separate responsibility: `fitCamera` derives the pose
and clip interval from the current bounds and orientation, with a small finite
depth margin. It does not retain near/far values or eye distance from a prior
scene, and repeated fitting of unchanged inputs is idempotent.
