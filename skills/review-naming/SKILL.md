---
name: review-naming
description: Part 4 of the `adversarials` 4-pass review suite. Use whenever asked to run "adversarials" or before pushing or publishing. Audits every file name, type, function, variable, schema field, route, export, test title, and doc term against docs/standards/NAMING_VOCABULARY.md, repo-local NAMING.md, library docs/VERBS.md, and retired terms — explicitly hunting within-diff synonym drift so one concept has one exact name everywhere.
---

# Vocabulary & Naming Consistency Review

## Why

A second name for the same concept is the same failure as a second implementation: it hides parallel machinery, forces every human and agent reader to mentally translate between synonyms, and lets code, tests, and docs drift apart. Checking vocabulary independently catches both rule violations and loose within-diff synonym drift that correctness reviews overlook (`docs/standards/NAMING_VOCABULARY.md`).

## Scope

Audit every file name, type, function, variable, parameter, schema field, route, export, test title, and doc/comment term introduced or changed in the diff against `docs/standards/NAMING_VOCABULARY.md`, repo-local `NAMING.md`, library `docs/VERBS.md`, and retired-term lists.

## Checklist

1. **Within-diff synonym drift (one concept, one exact word):** list the core domain concepts introduced or touched by the diff and verify every file name, type, variable, helper, test title, and doc uses the **exact same noun and verb** for each concept — never mixing loose synonyms across layers, files, or prose.
2. **Codebase concept reuse:** search the repository and lower libraries for each concept. If an established term already exists, use it instead of inventing a new one.
3. **Verbs match behavior:**
   - `fetch*` for I/O reads; noun phrase (no verb) for pure in-memory lookups; `*OrThrow` when absence throws; **no new `get*`**.
   - `make*` returns a function/handler/handle; `create*` writes records or builds adapter clients; `register*` mutates a registry; `define*` declares metadata only; `validate*`/`assert*` throws on failure; `is*`/`has*`/`can*` returns boolean.
4. **Literal, sentence-like labels:** read each name aloud as a short sentence. Rename anything cryptic, mechanism-focused, metaphorical, or misdescribing what the code actually does.
5. **Full model names in interfaces:** exported names, parameters, schema fields, and API payloads use full model names (never abbreviations in public contracts).
6. **Polymorphic sides:** `owner` (tenancy), `source`/`target` (directed edge), `resource` (one-sided slot), `subject` (log/event target), `actor` (who acted). Never `referenced*`.
7. **Soft-delete & field sensitivity:** `deleted` / `notDeleted` (never `live` for non-deleted rows); `sensitive` / `mask` / `redact` / `internal` / `no-op`.
8. **Shared-space IDs & casing:** namespaced through one central registry (no bare strings); model resources use `map:Model` casing; methods are `camelCase`, structured issue codes stay `snake_case`.
9. **Library `VERBS.md` & retired terms:** core library exports appear in `docs/VERBS.md` with a one-sentence meaning; zero retired terms reintroduced (`inixiative-config terms`).

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Concept Vocabulary Checked:** short list of the diff's core concepts and the one canonical term used for each.
3. **Renames Required:** table of `Location` | `Current Name` | `Proposed Name` | `Rule`.
4. **Confirmed Clean:** brief summary of scopes checked.
