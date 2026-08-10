---
name: Product change decision gate
about: Propose a bounded product or engineering change for triage
title: "[area] "
labels: enhancement
assignees: ""
---

## User value

Who benefits, and what concrete user-visible problem does this solve?

## Minimum behavior

What is the smallest behavior that delivers that value?

## Deletion candidates

What existing code, abstraction, or scope can be removed or simplified instead
of adding to the product?

## Non-goals

What related behavior is explicitly out of scope for this issue?

## Abstraction necessity

Why is a new public API, subsystem, compatibility layer, or mode necessary?
Which existing pattern was considered first?

## Product-scope classification

- [ ] Core now
- [ ] Project infrastructure
- [ ] Deferred (requires a fresh decision before implementation)
- [ ] Remove / cleanup

## Acceptance criteria

- [ ] The behavior is covered by an API, unit, benchmark, or e2e test as
      appropriate.
- [ ] The relevant wiki note and roadmap entry are updated.
