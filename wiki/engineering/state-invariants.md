# Invariant-driven state design

## Purpose

Invariant-driven state design makes broken states difficult to construct and
rejects invalid boundary input early, while keeping implementation small. It is
the repository term for the useful, concrete part sometimes called
"negative-space programming": define forbidden states and transitions,
preserve valid state, and test the relationships that expose regressions. It is
not a formal or universally standardized methodology.

## Definitions

- **Precondition** — what must be true at a public, untrusted, or ownership
  boundary before an operation begins. For example, `createElement` requires a
  supported shape and valid, unique node ids.
- **Postcondition** — what a successful operation guarantees. A successful
  scene build guarantees every placement reference resolves and the hierarchy
  is acyclic.
- **Invariant** — what remains true across every valid state and successful
  transition. A scalar color map always has a finite `min < max` range.
- **Pure transition** — returns a new value without mutating its input or
  hidden shared state, as the camera math functions do for a `Camera` value.
- **Inverse/metamorphic test** — checks a relationship instead of only one
  expected snapshot, such as zoom-in then zoom-out, serialize then parse, or
  repeated compilation producing the same result.

## Placement rules

- Validate once at the boundary that owns admission of a value.
- Use TypeScript types for structural constraints, including branded domain
  handles when distinct categories share the same runtime representation. Use
  runtime checks for
  numeric, cardinality, referential, and lifecycle constraints types cannot
  express.
- Treat a closed TypeScript union or const-derived discriminant as the complete
  admission rule in trusted TypeScript paths. Do not add repeated runtime
  membership checks for states the type excludes; validate separately only at
  a genuinely untyped data boundary that owns conversion into the typed domain.
- Keep internal helpers small and assume validated input unless they are
  independently public.
- Centralize a domain invariant in its owning subsystem; do not create a
  repository-wide generic assertion utility.
- Prefer explicit typed results for expected environmental failures and
  descriptive exceptions for programmer-invalid construction, following the
  existing subsystem convention.
- Test postconditions and invariants. Runtime-check every internal return only
  when silent corruption would cross an ownership boundary.

## Worker checklist

- What invalid states must be impossible?
- Which boundary admits the value?
- What is the smallest validation or transition owner?
- Does a successful transition preserve the prior domain invariants?
- Is there an inverse, round-trip, boundary, or repeated-operation test?
- Can a fallback, repair branch, duplicated validator, mutable intermediate, or
  new abstraction be deleted?

## Repository examples

- `ElementShape` makes unsupported shapes unrepresentable in typed callers;
  `createElement` validates the numeric and cardinality constraints its type
  cannot express. See [[data/elements-topology|Element topology]].
- Scene construction validates references and rejects a cyclic assembly
  hierarchy before creating its packed runtime; see
  [[architecture/packed-runtime|Packed runtime]].
- Results fields and scalar color maps validate field shapes and finite ranges;
  see [[data/results|Results]].
- Camera issue [#298] shows why a one-direction zoom test was insufficient:
  a transition can preserve `near < far` while degrading depth precision.
- Camera issue [#299] tracks public-boundary validation for the numeric and
  geometric invariants that types alone cannot represent.

## Anti-patterns and non-goals

Do not add assertion calls after every private helper, a global
Design-by-Contract framework, or a generic validation DSL/schema dependency.
Avoid catch-all repair or fallback branches, silently clamping malformed public
input unless clamping is documented behavior, and mutable shared state that is
temporarily invalid. Do not test only the happy direction of a reversible
operation, or widen a public API solely to expose validation internals.

[#298]: https://github.com/dirkphilip/femgx/issues/298
[#299]: https://github.com/dirkphilip/femgx/issues/299
[architecture/packed-runtime|Packed runtime]: ../architecture/packed-runtime.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[data/results|Results]: ../data/results.md
