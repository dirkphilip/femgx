# Contributing to FemGx

Thanks for helping improve FemGx. The project is experimental (0.1.0), so
please read the [product scope](wiki/requirements/product-scope.md) before
proposing API or capability changes. It is the source of truth for what is
supported, deferred, or out of scope.

## Development setup

Repository tooling requires Node 24 or newer. Clone the repository and install
the locked dependencies:

```sh
git clone https://github.com/dirkphilip/femgx.git
cd femgx
npm ci
```

The inspection workbench runs with:

```sh
npm run dev
```

The project is browser-first and rendering is WebGPU-only. A browser without a
working WebGPU device receives the typed unsupported result; there is no CPU
renderer fallback. Before starting another demo server, check whether one is
already running from another worktree.

## Common commands

| Command                    | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `npm run build`            | Type-check and build the package with declarations        |
| `npm run build:demo`       | Build the static inspection demo                          |
| `npm run build:docs`       | Generate the experimental API reference                   |
| `npm run typecheck`        | Run strict TypeScript and Svelte checks                   |
| `npm run lint`             | Run repository, source, public-doc, and dependency checks |
| `npm run lint:markdown`    | Check local Markdown and Foam links                       |
| `npm run format:check`     | Check Prettier formatting                                 |
| `npm run review:diff`      | Review change size, obsolete paths, and weakened tests    |
| `npm test`                 | Run the normal Vitest suite                               |
| `npm run test:core`        | Run core tests without demo/WebGPU/benchmark suites       |
| `npm run test:coverage`    | Run unit coverage with enforced thresholds                |
| `npm run test:package`     | Smoke-test a clean consumer installation                  |
| `npm run bench:budget`     | Run fast performance budgets and scaling checks           |
| `npm run test:e2e`         | Run serialized system-Chrome WebGPU journeys              |
| `npm run test:e2e:no-gpu`  | Verify the typed unsupported-WebGPU contract              |
| `npm run test:e2e:layout`  | Run desktop and phone layout checks                       |
| `npm run bench:webgpu`     | Run the opt-in real-WebGPU performance report             |
| `npm run test:e2e:install` | Install Playwright’s branded Chrome                       |

The normal test and budget lanes remain short. The large scaling proof is
opt-in and excluded from `npm test`, coverage, and CI. See the
[benchmark guidance](wiki/engineering/benchmarks.md) for methodology and
workloads.

## Hooks and validation

Husky installs the repository `pre-commit` hook. The hook runs lint-staged and
the pinned pre-commit framework; contributors also need the `pre-commit` CLI:

```sh
python3 -m pip install --user pre-commit
```

The [pre-commit hook guide](wiki/engineering/pre-commit-hooks.md) is
authoritative for the hook layers, pinned checks, CI behavior, and gotchas.

For documentation-only changes, format the intended Markdown files, then run:

```sh
npx prettier --write README.md CONTRIBUTING.md
git diff --check
npm run review:diff
```

For source changes, the handoff gate is:

```sh
npm run lint
npm run typecheck
npm test
npm run bench:budget
npm run review:diff
```

Rendering, camera, interaction, demo, CSS, and responsive-layout changes also
require real system-Chrome WebGPU evidence at desktop and 390×844 mobile
sizes. A no-GPU or submitted-frame check is not visual evidence.

## Contribution expectations

- Keep one logical change per pull request and preserve unrelated worktree
  changes.
- Extend an existing subsystem and public entry point when possible. New public
  concepts need a clear owner, identity story, end-to-end example, and API test.
- Add focused regression coverage for core-library bugs before fixing them.
- Keep production and test files within the repository’s size and function
  limits; split files when it improves cohesion.
- Update the internal [wiki](wiki/index.md) for durable architectural decisions,
  requirements, benchmarks, or WebGPU gotchas.
- Do not create issues or make external changes on behalf of the project unless
  the task explicitly authorizes it.
