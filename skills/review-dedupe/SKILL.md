---
name: review-dedupe
description: Part 3 of the `adversarials` 4-pass review suite. Use whenever asked to run "adversarials" or before reporting non-trivial work or publishing any package. Runs a full-package and cross-repo duplication audit by building a concept inventory across the whole repo, lower-level libraries, and sibling repos first — requiring an actual run before accepting any "it doesn't fit" claim.
---

# Full-Package & Cross-Repo Duplication Audit

## Why

Parallel machinery is the biggest source of drift across a multi-repo codebase. A diff-only review misses helpers that already live elsewhere in the package, in a lower-level library, or in a sibling repo — and verbal claims that an existing primitive "doesn't quite fit" routinely collapse the moment the case is actually run against it (`docs/standards/ENGINEERING_DOCTRINE.md` §3).

## Scope

Your scope is the **entire package, lower-level `@inixiative/*` libraries, standard utilities (`lodash-es`), and sibling repos** — never just the diff in isolation.

## Procedure

1. **Inventory first (by concept, not name):**
   - List every distinct job the diff performs (traversal, caching, locking, validation, auth/permissions, serialization, error mapping, query building, object/collection transforms, UI state, CLI parsing, etc.).
   - Search by concept across:
     1. The whole current repository (code search and map/index tools where available),
     2. Every lower-level internal library it depends on (check each library's `docs/VERBS.md` and `src/`),
     3. Sibling repositories where the same concern already has an owner.
2. **Judge the diff against the inventory:**
   - Flag any new helper, utility, walker, validator, schema, hook, or component that re-implements or parallels an existing one.
   - Flag hand-rolled object/collection transforms where `lodash-es` already provides the operation (`docs/standards/CODE_STYLE.md` §3).
   - Flag the same job implemented in two repositories — **one repo owns it, the others consume it**.
3. **Enforce "run before claiming it doesn't fit":**
   - Never accept a verbal argument that an existing primitive cannot handle the case.
   - To clear a near-match, express the real case on the existing primitive and run it (or prove from its code/tests with exact line citations) why extending or composing it fails.
4. **Follow signature changes everywhere:**
   - When a shared helper or export changes, verify no old copy, alias, or stale caller/doc remains.

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Concept Inventory Checked:** short table mapping each touched concept → existing primitives/repos searched.
3. **Duplication Findings:** for each finding — new path, existing owner path, what to delete, and how to consume/extend the existing owner.
