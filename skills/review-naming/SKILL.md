---
name: review-naming
description: Use to audit new or renamed functions, types, fields, routes, files, exports, and docs against docs/standards/NAMING_VOCABULARY.md, library docs/VERBS.md files, and retired-term lists before pushing or publishing.
---

# Naming & Vocabulary Review

Audit every identifier, export, schema field, route, file name, and doc term introduced or changed in the diff against `docs/standards/NAMING_VOCABULARY.md` (and any repo-local `NAMING.md` / `docs/VERBS.md`).

## Checklist

1. **Verbs match behavior:**
   - `fetch*` for I/O reads; noun phrase (no verb) for pure in-memory lookups; `*OrThrow` when absence throws; **no new `get*`**.
   - `make*` returns a function/handler/handle; `create*` writes records or builds adapter clients; `register*` mutates a registry; `define*` declares metadata only; `validate*`/`assert*` throws on failure; `is*`/`has*`/`can*` returns boolean.
2. **One name per concept:** search the codebase for the concept. If a name already exists for it, use it — never introduce a synonym.
3. **Sentence-like, literal Rails-style labels:** read each name aloud as a short sentence. Rename anything cryptic, mechanism-focused, metaphorical, or misdescribing what it actually does.
4. **Full model names in interfaces:** exported names, parameters, schema fields, and API payloads use full model names (`organization`, not `org`).
5. **Polymorphic sides:** `owner` (tenancy), `source`/`target` (directed edge), `resource` (one-sided slot), `subject` (log/event target), `actor` (who acted). Never `referenced*`.
6. **Soft-delete & field sensitivity:** `deleted` / `notDeleted` (never `live` for non-deleted rows); `sensitive` / `mask` / `redact` / `internal` / `no-op`.
7. **Shared-space IDs & casing:** namespaced through one central registry (no bare strings); model resources use `map:Model` casing (`db:Inquiry`); methods are `camelCase`, structured issue codes stay `snake_case`.
8. **Library `VERBS.md` & retired terms:** core library exports appear in `docs/VERBS.md` with a one-sentence meaning; zero retired terms reintroduced (`inixiative-config terms`).

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Renames Required:** table of `Location` | `Current Name` | `Proposed Name` | `Rule`.
3. **Confirmed Clean:** brief summary of scopes checked.
