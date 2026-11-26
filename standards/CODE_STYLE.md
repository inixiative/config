# Code Style

Universal code-style standards across all inixiative repositories. Grounded in [GREAT_PROGRAMMER.md](GREAT_PROGRAMMER.md): code is read 10×–50× more than it is written, and consistent style keeps every file predictable to scan.

---

## 1. Flat Controller-Style Control Flow & Step-by-Step Structure

Write handlers, plugins, hooks, middlewares, and services so they read **top-to-bottom like a controller** with flat guard clauses and single-line early exits — never nested `if`/`else` pyramids or nested ternaries.

- **Early exits over nesting:** reject invalid/empty states at the top and keep the main path flat at the bottom.
- **No nested ternaries:** a single short ternary is fine; branching ternaries belong in a small helper, lookup map, or flat `if` returns.
- **Step-by-step orchestration:** when a function performs multiple distinct phases (collect, load, transform, link, persist), extract focused named helpers so the entry point reads top-to-bottom as a short sequence of steps instead of a 100-line nested loop.

```typescript
// Good — flat early exits, obvious happy path at the bottom
if (!user) throw makeError({ status: 404, message: 'User not found' });
if (!session.verified) return c.json({ requiresTwoFactor: true }, 403);
if (!valid) return null;

return issueToken(user);
```

```typescript
// Bad — nested branches force the reader to hold a stack in their head
if (user) {
  if (session.verified) {
    if (valid) {
      return issueToken(user);
    }
  } else {
    return c.json({ requiresTwoFactor: true }, 403);
  }
}
```

---

## 2. Atomic Files (No Grab-Bag Modules)

- **One file, one concern, one named export** (internal private helpers stay unexported in the same file).
- Never build multi-hundred-line grab-bag `service.ts` / `utils.ts` files exporting a dozen unrelated functions; split by distinct responsibility when a module grows multiple coherent sub-stages.
- Never duplicate an existing flow inline beside a helper; extract once and call from both sites.
- **Minimal index files:** barrels live only at package or module root, never nested in internal subdirectories.

---

## 3. Standard Library Utilities Over Hand-Rolled Transforms

Prefer `lodash-es` (`omit`, `pick`, `pickBy`, `omitBy`, `mapValues`, `mapKeys`, `keyBy`, `zipObject`, `groupBy`, `uniqBy`) over hand-rolled `Object.fromEntries(Object.entries(...).filter/map(...))` chains or manual object-cloning loops. Hand-rolled object plumbing is harder to scan and easy to get subtly wrong.

---

## 4. Comments: Default to Zero

- **Do not write comments explaining *what* the code does.** Rename variables/functions or restructure the code instead. Comments rot, drift out of sync, and make files harder to scan.
- The **only** permitted comments are:
  1. Structured `@atlas` / doc-tool annotation blocks at the top of a file (or public JSDoc on exported library APIs where required).
  2. Rarely (~1% of files), a single short `// why: ...` line capturing a non-obvious constraint the code cannot express (an external bug workaround, a cross-process invariant, a subtle ordering requirement). Never multi-paragraph narration.

---

## 5. Errors, Validation, and No Defensive Theater

- **Just throw — no Go-isms.** Never return `{ ok: true | false }` result unions alongside `*OrThrow` twins, and never make callers write `if (!verified) throw ...` when the called function owns the failure. Throw a structured domain error directly.
- **Check once, at the entry point.** Validate at the controller, hook, or boundary entry; inner services trust their typed inputs instead of re-checking the same invariant.
- **Let existing boundaries own their errors.** Never wrap schema validation in `safeParse` + a hand-built error when the error handler already maps validation errors, and never write manual duplicate pre-checks where a unique constraint already enforces uniqueness.
- **A `catch` that doesn't rethrow is a bug unless it acts on the failure.** Logging and continuing hides broken state. Acting means a real state transition the caller needs (marking a row disabled, translating a library error). Cleanup goes in `finally`. Never wrap calls in `try/catch` or `.catch(log)` just to log.
- **No defensive-code theater:** don't re-check a library's own contract, and don't add defense-in-depth clamps without a concrete boundary reason.

---

## 6. TypeScript & Formatting

Managed uniformly via `@inixiative/config` (`biome/base.json`, `tsconfig/base.json`):

- **No `any`.** Type-check tests too; import canonical types from source modules.
- **Prefer `type` over `interface`** (unless declaration merging is needed).
- **No TypeScript `enum`** — use `as const` objects / string literal unions.
- **Named exports over default exports.**
- **Formatting:** 2-space indent, width 100, single quotes, trailing commas, semicolons, explicit return types on exported functions.
- **Variable prefixes:** `_` for unused bindings; `__` for private/module-internal state.
- **Fix CI and lint rules for real** — never disable rules or route around checks.
