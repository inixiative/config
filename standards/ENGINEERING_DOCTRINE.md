# Engineering Doctrine

Shared engineering principles across all inixiative repositories. Pair with [GREAT_PROGRAMMER.md](GREAT_PROGRAMMER.md), [CODE_STYLE.md](CODE_STYLE.md), and [NAMING_VOCABULARY.md](NAMING_VOCABULARY.md).

---

## 1. Understand the Why First

Before touching the *how* of anything non-trivial, hold the **why**: what the thing is for and the problem it exists to solve. Working a mechanism without holding its purpose produces category errors that feel like progress — stripping the wrong layer, "simplifying" away a load-bearing invariant, or conflating two concerns because they rhyme at the code level.

- Ask *"what is this for?"* before *"how does it work?"* If you cannot state the purpose in one sentence, find it (user's words, docs, callers, git history) or ask.
- Re-anchor after long stretches of plumbing. Repeated *"are you sure?"* pushback means you lost the frame: stop and recover the purpose before continuing.
- **Record the why, not just the how.** Every doc, plan, decision line, and PR states the problem it solves and the evidence or principle that chose it.

---

## 2. Decomposition by Default

Before jumping to implementation, break the problem into its atomic concerns:

- Which parts change independently? Those are separate responsibilities.
- Which parts have different lifecycles (created/deleted at different times, owned by different entities)? Those are separate records.
- Who owns this data, who controls access to it, and who consumes it? If the answers differ, they are different models.

**Lazy instincts to resist:**
- *"Just add a field"* — is this the same concern or a new concern wearing the same clothes?
- *"Just copy the logic"* — same operation = shared abstraction; different operation = keep separate even if they look similar.
- *"Just put it all in one table/function/component"* — convenience now is permanent coupling later.

---

## 3. Look for the Thing Already Doing It (Bridge Analysis)

Before adding a function, field, parameter, table, route, store, or module, search by **concept** (not just name) across this repo, sibling repos, and lower-level `@inixiative/*` libraries.

- **Make it visible:** every plan, ticket, and PR names, for each concern it touches (auth, permissions, db access, requests, locks, jobs, events, errors), the existing primitive it uses with its path — or explains why none fits.
- **"Why none fits" requires a bridge analysis:** show what would make the existing primitive fit (extend it, add a parameter, compose two), express and run the case on the existing primitive with output, and show why that bridge fails. *"It doesn't match exactly"* is not a reason.
- **Overriding an existing system requires explicit acknowledgement.** If an instruction or ticket contradicts an existing system without naming it and saying to replace or bypass it, stop and ask: *"This doesn't match what we have (X); confirm?"*
- **One repo owns a job; the others consume it.** Never maintain parallel implementations across sibling repos.

---

## 4. YAGNI: Scope Invention vs. Completion

The error runs in **both** directions:

- **Overbuild (scope invention) — cut it:** extra fields "in case we need them later", wrappers around single-call sites, defensive try/catch that cannot act on the error, backwards-compat shims, dead barrels, redundant comments.
- **Underbuild (trimming real completion) — finish it:** when the task IS "build primitive X", build what makes X complete and usable (configuration, testability, version awareness, shared abstraction) rather than shipping a stub that forces a v2 next week.
- **Tiebreaker:** foundations (`packages/shared`, core primitives, `@inixiative/*` libraries) lean build-complete; feature code leans trim. Real judgment calls in either direction are surfaced to the user, never decided silently.

---

## 5. Interrogate Before Proposing (Discovery Work)

For work where the shape is not yet settled (design, taxonomy, modeling, naming, architecture):

- Lead with questions and surface forks before closing the design space.
- **Talk through semantic changes before coding.** For changes to what a primitive *means* (lenses, gates, layering, new options/modes), bring a one-paragraph spec, concrete test cases, and a history check before writing code. Mechanical work (ports, confirmed bugs, cleanups) executes autonomously.
- **History first:** check prior rulings, git log, and docs before redesigning something already settled.
- **Small piece → validate → extend.** Validate one concrete sample before fanning out.

---

## 6. Premise Smell, No Cutouts, No Special Cases

- **No cutouts fighting the primitive:** if a fix needs a new bypass flag, option, or mode to paper over a caller mismatch, the premise is wrong. Never add an escape hatch that violates a primitive's own invariants; express what you want through composition or fix the general rule.
- **No special cases:** a carve-out for one input is a missing general rule. Restate the case another way — if a sibling behaves differently, fix the rule.
- **No backwards compatibility (pre-users):** make clean hard cuts. No dual-accept shims, deprecated aliases, or transitional code.

---

## 7. Review Team Before Anything Lands

Non-trivial changes pass through independent review passes (see `.claude/skills/inixiative-review-*/`):

1. **Plan & Bridge Review (`review-plan`)** — before coding on semantic/architectural changes.
2. **Architectural Subtractor (`review-subtractor`)** — explicit 30–50% deletion mandate plus a mandatory stale-plumbing & surviving-parts reassessment, run **before coding** (on the 10-line prose/diagram plan), **before merge**, and **after every architectural or refactor round before pushing**.
3. **Full-Package Duplication Audit (`review-dedupe`)** — whole package + lower libraries + sibling repos.
4. **Adversarial Review (`review-adversarial`)** — correctness, security, tenant boundaries, races, data loss, contracts, and flagging superseded/stale fallback paths for deletion rather than hardening them.
5. **Naming Review (`review-naming`)** — against [NAMING_VOCABULARY.md](NAMING_VOCABULARY.md) and library `VERBS.md`.
6. **Cleanup Scan (`cleanup-scan`)** — full outgoing-diff sweep before push.
