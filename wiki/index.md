# femgx wiki

This wiki is the project’s human- and agent-readable memory. Notes are grouped
by ownership area so the root index stays navigable as the project grows.
Links use Foam/Obsidian `[[path/to/note|label]]` syntax.

## Areas

- [[requirements/index|Requirements and product scope]] — the authoritative
  product-scope contract: what is Core now, Deferred, or Remove, and the
  decision gate for proposed additions.
- [[architecture/index|Architecture and API]] — public vocabulary, scene
  ownership, instancing, runtime compilation, and source boundaries.
- [[data/index|Data and FE models]] — element topology, results, import/export,
  and deterministic fixtures.
- [[rendering/index|Rendering and interaction]] — camera, WebGPU, picking,
  interaction state, and renderer resource behavior.
- [[engineering/index|Engineering and quality]] — benchmarks, quality gates,
  packaging, performance risks, test strategy, decisions, and roadmap.
- [[operations/index|Operations and workflow]] — development loop and
  Supervisor notes.

## Conventions

- Keep one concise markdown file per topic under its owning area.
- Name notes with `kebab-case` and link them with path-qualified wiki links.
- Add every new note to its area index and add new areas to this root index.
- Cross-link related notes instead of copying the same design rationale.
- Record resolved issues as resolved rather than deleting their history.
