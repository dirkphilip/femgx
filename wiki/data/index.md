# Data and FE models

- [[data/elements-topology|Element topology]] — typed finite-element shapes,
  canonical node ordering, and face/edge extraction.
- [[requirements/surface-derived-part-authoring|Surface-derived part authoring]]
  — compact mixed facet, line, and point input without omitted solid topology.
- [[data/fe-fixture|FE fixture]] — deterministic procedural FE datasets used by
  the demo and tests.
- [[data/io-import-export|IO import/export]] — versioned interchange model and
  VTK legacy adapter.
- [[data/glb-import|GLB display-scene import]] — bytes-only CAD scene mapping,
  diagnostics, styles, and compression evidence.
- [[data/results|Results, deformation, and scalar visualization]] — typed
  authored result fields, scalar mapping, deformation, and visualization data.
- [[data/vector-field-visualization|Authored elemental orientation visualization]]
  — the bounded Core-now contract for authored normal and fiber-orientation glyphs.

[data/elements-topology|Element topology]: elements-topology.md
[data/fe-fixture|FE fixture]: fe-fixture.md
[data/io-import-export|IO import/export]: io-import-export.md
[requirements/surface-derived-part-authoring|Surface-derived part authoring]: ../requirements/surface-derived-part-authoring.md
[data/results|Results, deformation, and scalar visualization]: results.md
[data/vector-field-visualization|Authored elemental orientation visualization]: vector-field-visualization.md
