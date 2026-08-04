# femgx wiki

This wiki is the human- and agent-readable memory of the femgx project. It uses
Obsidian/Foam-style `[[wiki-link]]` links so notes are navigable as a knowledge
graph (open the repo as a vault, or follow the index files in a plain editor).

## Index

- [[architecture-overview|Architecture overview]] — scene model, renderer split,
  and ownership boundaries.
- [[instancing-strategy|Instancing strategy]] — parts, assemblies, and how
  geometry is reused via GPU instancing.
- [[elements-topology|Element topology]] — typed finite-element shapes, canonical
  node ordering, connectivity validation, and oriented face/edge extraction.
- [[results|Results, deformation, and scalar visualization]] — typed result
  fields, derived quantities, ranges, color mapping, and deformed-shape data.
- [[packed-runtime|Packed scene runtime]] — packed typed-array storage and
  delta-oriented visibility updates.
- [[renderer-subrange-updates|Renderer subrange updates]] — packed deltas wired
  into GPU subrange writes for transform/style/visibility attributes.
- [[interactive-state|Interactive state]] — highlight, selection, and visibility
  as per-instance GPU attributes.
- [[element-interaction|Element-level interaction]] — element picking, selection,
  and GPU emphasis records with stable element ids.
- [[pick-format|Pick texture format]] — the `rgba8unorm` pick readback format,
  why it replaced `r32uint`, and the supported pick-id range.
- [[scaffold-decisions|Scaffold decisions]] — toolchain, strictness, and the
  initial library structure.
- [[source-organization|Source organization]] — subsystem directory layout and
  the public-boundary convention.
- [[quality-gate|Quality gate]] — CI, coverage thresholds, and the local gate
  every agent runs before handoff.
- [[typescript-toolchain-compatibility|TypeScript toolchain compatibility]] —
  TypeScript and typescript-eslint peer-version constraints.
- [[packaging|Packaging]] — ESM/CJS builds, declaration resolution modes,
  `@webgpu/types` dev-only, and the clean-consumer smoke tests.
- [[webgpu-e2e|WebGPU browser e2e lane]] — opt-in real-WebGPU browser coverage
  that never makes the default CI lane flaky.
- [[benchmarks|Benchmarks and performance budgets]] — deterministic CPU
  benchmarks, budget thresholds, and how to run/interpret them.
- [[performance-issues|Performance issues and risks]] — known scalability,
  correctness, renderer, and toolchain gaps.
- [[webgpu-resource-reuse|WebGPU resource reuse]] — cached frame resources and
  the readback-map synchronization constraints.
- [[todo|Engineering TODO]] — prioritized implementation roadmap.
- [[supervisor-workflow|Supervisor workflow]] — launching `sv` via `uvx`,
  provider setup, and useful commands.
- [[supervisor-label-matching|Supervisor label matching]] — how configured
  allow/ignore labels match GitHub issue labels, and the migration behavior.
- [[development-loop|Development loop]] — issue triage, Supervisor monitoring,
  PR completion, and safe long-running iteration.
- [[fe-fixture|FE fixture]] — the deterministic procedural panel fixture used by
  the demo and unit tests.

## Conventions

- One markdown file per topic in `wiki/`, named `kebab-case`.
- Link related notes with `[[wiki-link]]`; prefer linking over duplicating.
- Add every new note to this index.
- Keep notes concise and current; mark resolved issues as resolved.
