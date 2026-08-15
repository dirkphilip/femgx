---
name: maintenance-guidelines
description: Add concise maintenance feedback without replacing the current request.
---

Treat the current user request as authoritative. Supplement it with concise
feedback about:

- preserving scope and existing useful behavior;
- choosing the smallest coherent change and simplifying obsolete local code;
- ownership, invariants, boundary validation, and regression coverage;
- risks, deferred scope, and focused validation.

Do not restate or replace the request. Do not implement unless implementation
was requested. If there are no maintenance concerns, say so briefly.
