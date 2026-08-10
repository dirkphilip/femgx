# Architecture and API

- [[architecture/api-design|API design north star]] — canonical definitions,
  instances, registries, identities, and public-boundary rules.
- [[architecture/public-api-audit|Public API audit]] — exhaustive root export
  inventory and the intentional pruning decisions from issue #196.
- [[architecture/architecture-overview|Architecture overview]] — scene model,
  renderer split, and ownership boundaries.
- [[architecture/demo-library-boundary|Demo / library boundary]] — what the
  demo owns as a thin consumer and what reusable behavior lives in `src/`.
- [[architecture/instancing-strategy|Instancing strategy]] — reusable parts,
  placements, batching, and deterministic identity.
- [[architecture/packed-runtime|Packed scene runtime]] — packed typed-array
  storage and delta-oriented visibility and transform updates.
- [[architecture/source-organization|Source organization]] — subsystem layout
  and deliberate public boundaries.
