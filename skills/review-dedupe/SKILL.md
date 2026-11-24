---
name: review-dedupe
description: Use before reporting non-trivial work to the user or publishing any package to run a full-package and cross-repo duplication audit. Builds an inventory across the whole package, sibling repos, and lower-level @inixiative/* libraries first, then judges the diff against it — requiring an actual run before accepting any "it doesn't fit" claim.
---

# Full-Package & Cross-Repo Duplication Audit

You are running the **Duplication Audit** (`docs/standards/ENGINEERING_DOCTRINE.md` §3). Your scope is the **entire package, lower-level `@inixiative/*` libraries, and sibling repos** — never just the diff in isolation.

## Procedure

1. **Inventory first (by concept, not name):**
   - Identify every job the diff performs (traversal, caching, locking, validation, auth/token handling, serialization, error mapping, query building, UI state, CLI parsing, etc.).
   - Search for existing implementations across:
     1. The whole current repository (`git grep`, `bunx atlas query` if available),
     2. Every lower-level `@inixiative/*` library it depends on (check each library's `docs/VERBS.md` and `src/`),
     3. Sibling repos (`template`, `kingdom`, `foundry`, `oracle`, `config`, etc.) where the same job may already live.
2. **Judge the diff against the inventory:**
   - Flag any new helper, utility, walker, validator, schema, hook, or component that re-implements or parallels an existing one.
   - Flag the same job implemented in two repositories — **one repo owns it, the others consume it**.
3. **Enforce "run before claiming it doesn't fit":**
   - Never accept a verbal claim that an existing primitive cannot handle the case.
   - To clear a near-match, express the real case on the existing primitive and run it (or prove from its code/tests with exact line citations) why it cannot be bridged by extending or composing it.
4. **Follow signature changes everywhere:**
   - When a shared helper or export changes, verify no old copy, alias, or stale caller remains.

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Concept Inventory Checked:** short table mapping each touched concept → existing primitives/repos searched.
3. **Duplication Findings:** for each finding — new path, existing owner path, what to delete, and how to consume/extend the existing owner.
