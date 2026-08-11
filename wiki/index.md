# femgx wiki

This wiki is the project’s human- and agent-readable memory. Notes are grouped
by ownership area so the root index stays navigable as the project grows.
Links use Foam `[[path/to/note|label]]` syntax. Committed link-reference
definitions with `.md` targets keep the same links navigable in GitHub-rendered
Markdown.

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
  packaging, performance risks, test strategy, and durable decisions.
- [[operations/index|Operations and workflow]] — CI and repository workflow
  notes.

## Conventions

- Keep one concise markdown file per topic under its owning area.
- Name notes with `kebab-case` and link them with path-qualified wiki links.
- Add every new note to its area index and add new areas to this root index.
- Cross-link related notes instead of copying the same design rationale.
- Record resolved issues as resolved rather than deleting their history.

## Workflow

- Open the repository in VS Code with the Foam extension to author and navigate
  `[[wikilinks]]`.
- Keep the generated link-reference definitions at the end of notes. The
  repository configures Foam to use `.md` targets so GitHub can render the same
  links.
- Use GitHub issues and pull requests for collaboration and review.

[architecture/index|Architecture and API]: architecture/index.md
[data/index|Data and FE models]: data/index.md
[engineering/index|Engineering and quality]: engineering/index.md
[operations/index|Operations and workflow]: operations/index.md
[rendering/index|Rendering and interaction]: rendering/index.md
[requirements/index|Requirements and product scope]: requirements/index.md
