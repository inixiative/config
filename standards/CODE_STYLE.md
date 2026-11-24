# Code Style

Universal code-style standards across all inixiative repositories. Grounded in [GREAT_PROGRAMMER.md](GREAT_PROGRAMMER.md): code is read 10×–50× more than it is written.

---

## 1. Flat Controller-Style Control Flow

Write handlers, plugins, hooks, middlewares, and services so they read **top-to-bottom like a controller** with flat guard clauses and single-line early exits — never nested `if`/`else` pyramids.

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
- Never build multi-hundred-line grab-bag `service.ts` / `utils.ts` files exporting a dozen unrelated functions.
- Never duplicate an existing flow inline beside a helper; extract once and call from both sites.
- **Minimal index files:** barrels live only at package or module root, never nested in internal subdirectories.

---

## 3. Comments: Default to Zero

- **Do not write comments explaining *what* the code does.** Rename variables/functions or restructure the code instead. Comments rot, drift out of sync, and make files harder to scan.
- The **only** permitted comments are:
  1. Structured `@atlas` / doc-tool annotation blocks at the top of a file (or public JSDoc on exported library APIs where required).
  2. Rarely (~1% of files), a single short `// why: ...` line capturing a non-obvious constraint the code cannot express (an external bug workaround, a cross-process invariant, a subtle ordering requirement). Never multi-paragraph narration.

---

## 4. Errors, Validation, and No Defensive Theater

- **Validators throw.** A validator throws a structured domain error; it never returns an error string or `undefined` for callers to branch on.
- **Check once, at the entry point.** Validate at the controller, hook, or boundary entry; inner services trust their typed inputs instead of re-checking the same invariant.
- **A `catch` that doesn't rethrow is a bug unless it acts on the failure.** Logging and continuing hides broken state. Acting means a real state transition the caller needs (marking a row disabled, translating a library error). Cleanup goes in `finally`. Never wrap calls in `try/catch` or `.catch(log)` just to log.
- **No defensive-code theater:** don't re-check a library's own contract, don't hand-build errors the global error handler already maps, and don't add defense-in-depth clamps without a concrete boundary reason.

---

## 5. TypeScript & Formatting

Managed uniformly via `@inixiative/config` (`biome/base.json`, `tsconfig/base.json`):

- **No `any`.** Type-check tests too; import canonical types from source modules.
- **Prefer `type` over `interface`** (unless declaration merging is needed).
- **No TypeScript `enum`** — use `as const` objects / string literal unions.
- **Named exports over default exports.**
- **Formatting:** 2-space indent, width 100, single quotes, trailing commas, semicolons, explicit return types on exported functions.
- **Variable prefixes:** `_` for unused bindings; `__` for private/module-internal state.
- **Fix CI and lint rules for real** — never disable rules or route around checks.
