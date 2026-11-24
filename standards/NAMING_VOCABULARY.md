# Naming and Vocabulary

Universal naming rules across all inixiative repositories. A second name for the same concept is the same failure as a second implementation.

---

## 1. Core Principles

- **Sentence-like names:** a name reads like a short sentence saying what the code does, to what, and whether it does I/O, throws, or writes — internal names included, never cryptic shortcuts.
- **Literal Rails-style labels:** say what the thing *is*, not its mechanism or a metaphor (`check` stays `check`; never invent clever euphemisms).
- **Full model names in every interface:** exported symbols, parameters, schema fields, and API shapes use full model names (`organization`, not `org`). Short local loop variables are tolerated, not preferred.
- **Core library `VERBS.md`:** every core library keeps a `docs/VERBS.md` mapping one verb per operation to one implementation and a one-sentence meaning (verified by tests). Read it — and the lower library's `VERBS.md` — before naming anything.
- **Retired names stay retired:** once a term is retired (see `@inixiative/config` `terms`), it never returns in code, docs, or comments.

---

## 2. Standard Verb Table

| Verb / Form | Meaning | Examples |
|---|---|---|
| `fetch*` | Any I/O read (database, cache, Redis, HTTP, filesystem) | `fetchUserById`, `fetchThroughCache` |
| Noun phrase (no verb) | Pure in-memory lookup or derived value | `roleOf`, `ownerKeys`, `activeCandidates` |
| `*OrThrow` | Lookup or fetch where absence throws instead of returning `null`/`undefined` | `fetchUserOrThrow` |
| `make*` | Returns a function, handler, controller, middleware, or handle | `makeController`, `makeError`, `makeRateLimit` |
| `create*` | Writes a persisted record or builds an adapter client | `createUser`, `createBillingClient` |
| `register*` | Adds an entry to a registry | `registerRoute`, `registerHook` |
| `define*` | Declares metadata/configuration only (no side effect) | `defineSetting`, `defineTransition` |
| `validate*` / `assert*` | Throws on invalid input or violated invariant | `validateConfig`, `assertTransition` |
| `is*` / `has*` / `can*` | Pure boolean predicate | `isSuperadmin`, `canGrantEntitlement` |

**No new `get*`:** use `fetch*` for I/O or a noun phrase for in-memory lookups.

---

## 3. Polymorphic Side Names

Every polymorphic relationship uses the exact role name of its side — **never `referenced*`**:

| Side | Meaning | Example |
|---|---|---|
| `owner` | Tenancy / ownership only (`ownerModel`, `ownerId`) | `Token`, `Integration`, `BillingAccount` |
| `source` / `target` | The two ends of a directed edge (`sourceModel`/`sourceId`, `targetModel`/`targetId`) | `Inquiry`, `RuleReference`, `Entitlement` |
| `resource` | A one-sided polymorphic slot (`resourceModel`, `resourceId`) | `TagAttachment`, `Setting` |
| `subject` | The row a log or event is about (`subjectModel`, `subjectId`) | `AuditLog` |
| `actor` | Who performed the action | Request auth context, audit actor |

---

## 4. Soft-Delete Vocabulary

- Standardize strictly on **`deleted`** and **`notDeleted`** (`notDeletedWhere`, `notDeletedIncludes`, `notDeletedScope`, `notDeletedCount`).
- **Never use `live`** to mean "not soft-deleted" (`deletedAt === null`). Reserve `live` strictly for real-time/running meanings (live streams, live queries, live deploys).

---

## 5. Field Sensitivity Vocabulary

| Term | Meaning |
|---|---|
| `sensitive` | Value never leaves the server or logs |
| `mask` | Hide the value in output while recording that it changed |
| `redact` | Erase a person's data only |
| `internal` | Never leaves for privilege / visibility reasons |
| `no-op` | Change not worth auditing or recording |

---

## 6. Shared-Space Identifiers

- IDs in a shared namespace (Redis keys, role IDs, resource names) **always carry a namespace prefix from one central registry** (e.g. `redisNamespace`, `roleNamespace`) — never bare hand-typed strings.
- Resource names use the model's exact casing (`map:Model`, e.g. `db:Inquiry`, `actor:User`) with no translation table; column and relation names stay `camelCase`.
- Method names are `camelCase`; structured validation issue codes stay `snake_case`.
