# Composition rules for workbench v2

This folder contains a local ESLint plugin intended for the future
`demo/workbench-v2`. It is deliberately **not wired to the existing workbench**.
The current demo is the behavioral reference for a clean replacement, not the
structural foundation of that replacement.

## Why start again

The existing demo accumulated one controller that owns state, model loading,
viewport lifecycle, interaction, display policy, results, menus, snapshots, and
UI commands. Its many bound methods make call sites compact, but they hide which
object owns each operation and turn the controller into a service locator.

Several attempted refactors demonstrated failure modes worth preserving as
design guidance:

- Replacing `.bind()` with forwarding lambdas changes syntax, not ownership.
- Moving a large controller behind a small facade creates a hollow facade and a
  hidden god object.
- Splitting one callback bag into several effect bags can preserve the same
  service locator under new names.
- Anonymous owner adapters make TypeScript accept a design without making its
  responsibilities easier to follow.
- Numeric limits can be gamed by making methods private, converting methods to
  properties, or nesting broad bags.
- Hard interface/file quotas caused many tiny type-only files and made
  navigation worse. File count is therefore a review signal, not a rule here.
- Tests built with `Object.create`, private-field assignment, or universal
  command proxies miss construction and wiring defects.

The lesson is simple: lint can reject obvious symptoms, but only explicit state
and lifecycle ownership creates composition.

## Rules

The plugin exports four rules:

| Rule                                  |      Starting limit | Purpose                                                                                                                                             |
| ------------------------------------- | ------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composition/max-class-callables`     | 20 public, 25 total | Prevent a large API and prevent hiding the same behavior behind private methods. Accessor pairs and overloads count once; data fields do not count. |
| `composition/max-interface-callables` |                  15 | Keep behavioral ports focused. Function-valued properties count, so changing method syntax cannot bypass the limit.                                 |
| `composition/max-imports`             |                  20 | Flag modules coordinating too many subsystems. This is a smell, not proof of bad design.                                                            |
| `composition/no-bind`                 |                   0 | Keep ownership visible instead of building a registry of detached methods.                                                                          |

Use the repository's existing core rules alongside these: 400 effective lines
per file, 60 lines per function, 5 parameters, and nesting depth 4. Constructor
dependencies are already constrained by `max-params`; prefer one cohesive
options object only when its members describe one owned concept. An options
object that carries unrelated callbacks is still a service locator.

## Intended workbench-v2 ownership

The v2 composition root should create and connect concrete owners. It must not
be a callable registry or a facade over a second controller-shaped object.

- State store: pane-local display, selection, hover, and inspection state.
- Viewport runtime: primary/secondary viewport lifecycle and active-slot state.
- Model catalog: catalog mode, available models, and retained imported models.
- Model session: asynchronous import, cancellation, and late-result rejection.
- Presentation: snapshots, feedback, and UI reflection.
- Interaction: selection and hover transitions over the active viewport.
- Result playback: host-side timer and authored-snapshot sequencing.
- Composition root: construction order, cross-owner lifecycle, and destruction.

UI components should receive a presentation port with grouped command domains,
for example `commands.display.setBackground()` and
`commands.selection.clear()`. Each domain should be constructed beside the
state transitions it invokes. No command factory should receive the whole
application graph.

```text
start
  -> composition root
       -> model catalog + model session
       -> state store
       -> viewport runtime
       -> presentation
       -> interaction
       -> grouped command domains
  -> presentation port
       -> Svelte UI
```

Dependencies point toward the owner. UI never imports controllers, domain
modules never import UI, and a feature module does not imitate the composition
root with an `Owner`, `Context`, or `Effects` interface spanning unrelated
subsystems.

## Construction and testing rules

1. Establish immutable configuration and concrete state owners first.
2. Construct features before installing listeners that can call them.
3. Use deferred callbacks only for real event boundaries, never to conceal an
   initialization cycle.
4. Install listeners after every referenced owner exists.
5. Make destruction idempotent and reject late asynchronous completion.
6. Test the real composition seam. Do not fabricate classes with
   `Object.create`, assign private fields, or use a proxy that accepts every
   command name.
7. Test each grouped command surface with its real shape so UI migrations fail
   loudly when a domain changes.

## Future ESLint wiring

When `demo/workbench-v2` exists and passes these rules without exceptions, wire
the plugin only to that tree:

```js
import composition from "./eslint-rules/index.mjs";

{
  files: ["demo/workbench-v2/**/*.{ts,svelte}"],
  plugins: { composition },
  rules: {
    "composition/max-class-callables": "error",
    "composition/max-interface-callables": "error",
    "composition/max-imports": "error",
    "composition/no-bind": "error",
  },
}
```

Start v2 green. Do not add a baseline, compatibility facade, or per-file
exception for a new god object. If a limit rejects a cohesive module, review the
ownership and tests before changing the number.

These rules intentionally do not cap interfaces per file, exports per module,
or classes per file. Those metrics can identify a junk drawer, but hard quotas
encourage type aliases, barrels, and microfiles without improving ownership.

## What about `src/`?

The plugin is generic enough to evaluate library code later, but this PR does
not enable it for `src/`. The library API is already organized around clearer
subsystem and package-entry boundaries than the demo, and rendering composition
modules may have legitimate dependency patterns that need separate evidence.

Before enabling a rule for `src/`, run it as a read-only audit, inspect every
violation by subsystem, and decide whether the finding represents mixed
ownership or a cohesive boundary. Do not copy the workbench thresholds into the
library merely for consistency, and do not add a baseline simply to make the
command green. A later policy change should be small, independently reviewable,
and start with the rules that reveal real defects rather than noisy metrics.
