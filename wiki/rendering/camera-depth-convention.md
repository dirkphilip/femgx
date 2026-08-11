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
