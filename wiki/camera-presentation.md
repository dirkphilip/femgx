# Camera presentation

The demo uses a perspective-first isometric pose so the wide element gallery
fits without the compressed look of a near orthographic camera. Perspective
framing is calculated from the fixture bounds and viewport aspect ratio.

Projection changes preserve vertical framing: converting from perspective derives
an orthographic height from camera distance, while converting back derives a
distance from that height. This avoids the apparent zoom jump that previously made
the perspective toggle look broken. See [[interactive-state]] for the related
interaction model and [[element-rendering]] for the demo geometry modes.

The demo follows CAD conventions for navigation: left-drag orbits, middle-drag
or Shift-left-drag pans, and the wheel zooms toward the orbit target. The demo
presentation uses a light studio background and restrained material colors so
geometry edges and selection emphasis remain legible.
