# Duplication checks

Advisory lint tools that find duplicated TypeScript by **structure**, not text. Identifiers
are normalized away (`value`, `x`, `first` all become the same shape), but operators and
control flow are kept (`+` vs `*`, `if` vs `while`, and so on).

All commands print findings to stdout and exit `0`. They are meant for review and refactor
planning, not as hard CI gates unless you opt in later.

## Layout

| File                    | Role                                                |
| ----------------------- | --------------------------------------------------- |
| `fingerprint.mjs`       | Shared AST fingerprinting (used by the checkers)    |
| `check-names.mjs`       | Top-level declaration **names** reused across files |
| `check-bodies.mjs`      | Whole top-level functions, types, and interfaces    |
| `check-fragments.mjs`   | Partial statement blocks inside function bodies     |
| `name-ignores.json`     | Allowlist for repeated declaration names            |
| `body-ignores.json`     | Allowlist for identical whole declarations          |
| `fragment-ignores.json` | Allowlist for line ranges                           |

Tests: `test/scripts/duplicates/`.

## Quick start

```bash
# All three checkers on src, test, and demo
npm run lint:duplicates

# One checker, one tree
npm run lint:duplicate-names
npm run lint:duplicate-bodies
npm run lint:duplicate-fragments

# Direct invocation (paths are relative to the scan root you pass)
node scripts/duplicates/check-names.mjs src
node scripts/duplicates/check-bodies.mjs src
node scripts/duplicates/check-fragments.mjs demo
```

## Names vs bodies vs fragments

**Names** answer: “Is this **identifier** reused as a top-level declaration in multiple files?”

- Scans top-level `function`, `type`, `interface`, `class`, `enum`, and `namespace` names.
- Ignores same-file merges, overloads, and names scoped inside namespaces or ambient modules.
- Catches confusion risks even when the implementations differ (`ViewportInteraction` as a class
  vs an interface, or three different `validateElements` functions).
- Example output:

  ```text
  "clamp" is declared in 3 file(s):
    camera/fit.ts:329 (function)
    interaction/box-frustum.ts:168 (function)
    interaction/box-selection.ts:290 (function)
  ```

**Bodies** answer: “Is this entire declaration duplicated elsewhere?”

- Scans top-level `function`, `type`, and `interface` declarations.
- Matches even when names differ (`clamp` vs `limit`).
- For interfaces and types, property names are ignored but **type names are kept**
  (`Vec3` vs `GPURenderPipeline` do not match).
- Example output:

  ```text
  Same function body in 2 file(s):
    renderer/visibility/skins.ts:352 contains
    renderer/visibility/packed-skin.ts:65 contains
  ```

**Fragments** answer: “Is this block of statements inside a function duplicated?”

- Slides over consecutive statements in functions, methods, and arrow-function bodies.
- Reports only **maximal** windows (no 8-line report when a 10-line superset already matches).
- Sorts by **line count descending** (16-line clones first, then 14, then 13, …).
- Example output:

  ```text
  16-line fragment clones:

  Fragment clone (16 lines, 6 statements, 2 files, score 32):
    geometry/packed/packed-validation.ts:77-92 in validateGeometry
    geometry/part.ts:245-261 in validateGeometryArrays
  ```

## Useful flags

### `check-names.mjs`

```bash
node scripts/duplicates/check-names.mjs src
node scripts/duplicates/check-names.mjs src --ignore scripts/duplicates/name-ignores.json
```

### `check-bodies.mjs`

```bash
node scripts/duplicates/check-bodies.mjs src
node scripts/duplicates/check-bodies.mjs src --ignore path/to/ignores.json
```

### `check-fragments.mjs`

```bash
# Only substantial refactor candidates
node scripts/duplicates/check-fragments.mjs src --min-lines 10

# Looser scan
node scripts/duplicates/check-fragments.mjs src --min-lines 6 --min-statements 3

# Limit output noise
node scripts/duplicates/check-fragments.mjs src --max-reports 30

# Custom ignore file
node scripts/duplicates/check-fragments.mjs src --ignore scripts/duplicates/fragment-ignores.json
```

| Flag               |                              Default | Meaning                                              |
| ------------------ | -----------------------------------: | ---------------------------------------------------- |
| `--min-lines`      |                                    6 | Minimum source lines in a fragment                   |
| `--min-statements` |                                    3 | Minimum consecutive statements in a window           |
| `--min-files`      |                                    2 | Require matches in at least this many distinct files |
| `--max-reports`    |                                  100 | Cap the number of reported clone clusters            |
| `--ignore`         | checker-specific JSON in this folder | Path to an ignore list                               |

If you omit the scan root, all checkers default to the repository `src/` directory.

## Ignore lists

Paths in ignore files are **relative to the scan root** you pass on the command line. When
you run `node scripts/duplicates/check-names.mjs src`, use paths like
`interaction/box-frustum.ts`, not `src/interaction/...`.

### Repeated names — `name-ignores.json`

Suppress a specific declaration occurrence when the shared name is intentional. Optional
`kind` disambiguates class vs interface with the same name.

```json
{
  "entries": [
    {
      "file": "interaction/viewport-interaction.ts",
      "name": "ViewportInteraction",
      "kind": "class"
    },
    { "file": "viewport/types.ts", "name": "ViewportInteraction", "kind": "interface" }
  ]
}
```

### Identical bodies — `body-ignores.json`

Suppress a specific declaration occurrence. Optional `kind` disambiguates name collisions.

```json
{
  "entries": [
    { "file": "interaction/box-frustum.ts", "name": "clamp", "kind": "function" },
    { "file": "interaction/box-selection.ts", "name": "clamp", "kind": "function" }
  ]
}
```

Add **both** sides when the same body with different names is intentional.

### Line ranges — `fragment-ignores.json`

Suppress fragments overlapping a range. Omit `startLine` / `endLine` to ignore the whole file.

```json
{
  "entries": [
    {
      "file": "renderer/selection/element-selection.ts",
      "startLine": 65,
      "endLine": 78
    }
  ]
}
```

## Tips

- Run **names** first for a quick smell test; it is fast and highlights naming collisions
  and parallel abstractions (`validateElements`, `InstanceLayout`, local `ElementId` aliases).
- Start with **fragments** at `--min-lines 10` on `src/` for the highest-value factor-out
  candidates; widen thresholds if you want a broader audit.
- **Bodies** are fast; **fragments** scan every statement window and take longer on large trees.
- Use all three together: a repeated **name** may need consolidation even when bodies differ;
  identical **bodies** with different names are refactor targets; long **fragments** are
  extract-helper candidates.
- These tools complement text-based clone detectors (for example jscpd): AST checks catch
  renamed copy-paste; text checks catch literal paste with the same variable names.
