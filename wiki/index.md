# femgx wiki

This wiki is the human- and agent-readable memory of the femgx project. It uses
Obsidian/Foam-style `[[wiki-link]]` links so notes are navigable as a knowledge
graph (open the repo as a vault, or follow the index files in a plain editor).

## Index

- [[architecture-overview|Architecture overview]] — scene model, renderer split,
  and ownership boundaries.
- [[instancing-strategy|Instancing strategy]] — parts, assemblies, and how
  geometry is reused via GPU instancing.
- [[packed-runtime|Packed scene runtime]] — packed typed-array storage and
  delta-oriented visibility updates.
- [[interactive-state|Interactive state]] — highlight, selection, and visibility
  as per-instance GPU attributes.
- [[scaffold-decisions|Scaffold decisions]] — toolchain, strictness, and the
  initial library structure.
- [[quality-gate|Quality gate]] — CI, coverage thresholds, and the local gate
  every agent runs before handoff.
- [[performance-issues|Performance issues and risks]] — known scalability,
  correctness, renderer, and toolchain gaps.
- [[todo|Engineering TODO]] — prioritized implementation roadmap.
- [[supervisor-workflow|Supervisor workflow]] — launching `sv` via `uvx`,
  provider setup, and useful commands.
- [[development-loop|Development loop]] — issue triage, Supervisor monitoring,
  PR completion, and safe long-running iteration.

## Conventions

- One markdown file per topic in `wiki/`, named `kebab-case`.
- Link related notes with `[[wiki-link]]`; prefer linking over duplicating.
- Add every new note to this index.
- Keep notes concise and current; mark resolved issues as resolved.
