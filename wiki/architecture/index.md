# Architecture and API

- [[architecture/api-design|API design north star]] — canonical definitions,
  instances, registries, identities, and public-boundary rules.
- [[architecture/bodies|Part bodies]] — stable body metadata and element
  membership owned by reusable geometry.
- [[architecture/core-api|Core API review]] — the concise review sheet for the
  canonical scene, viewport, interaction, picking, results, IO, and platform
  APIs.
- [[architecture/public-api-audit|Public API audit]] — exhaustive root export
  inventory and the intentional pruning decisions from issue #196.
- [[architecture/architecture-overview|Architecture overview]] — scene model,
  renderer split, and ownership boundaries.
- [[architecture/demo-library-boundary|Demo / library boundary]] — what the
  demo owns as a thin consumer and what reusable behavior lives in `src/`.
- [[architecture/instancing-strategy|Instancing strategy]] — reusable parts,
  placements, batching, and deterministic identity.
- [[architecture/packed-runtime|Packed scene runtime]] — packed typed-array
  storage and delta-oriented visibility updates.
- [[architecture/source-organization|Source organization]] — subsystem layout
  and deliberate public boundaries.

[architecture/api-design|API design north star]: api-design.md
[architecture/architecture-overview|Architecture overview]: architecture-overview.md
[architecture/bodies|Part bodies]: bodies.md
[architecture/core-api|Core API review]: core-api.md
[architecture/demo-library-boundary|Demo / library boundary]: demo-library-boundary.md
[architecture/instancing-strategy|Instancing strategy]: instancing-strategy.md
[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[architecture/public-api-audit|Public API audit]: public-api-audit.md
[architecture/source-organization|Source organization]: source-organization.md
