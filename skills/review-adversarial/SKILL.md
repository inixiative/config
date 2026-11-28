---
name: review-adversarial
description: Part 1 of the `adversarials` 4-pass review suite. Use whenever asked to run "adversarials" or before acting, reporting, or merging any plan, spec, fixture set, eval result, or outgoing code diff. Tries to break correctness, security, auth/tenant boundaries, concurrency, data integrity, API/schema contracts, and style consistency — returning reproduced findings and an APPROVE or REQUEST_CHANGES verdict.
---

# Adversarial Review (Correctness, Security & Style Consistency)

## Why

The author of a change is anchored on the happy path and the premise they built inside. Passing tests only confirm what the author thought to assert; they miss boundary failures, races, leaked state, stale fallbacks, and subtle style drift that compounds into unreadable codebases. An independent reviewer trying to break the change catches defects and consistency drift before they land.

## Scope

Inspect the full diff (`git diff origin/<default-branch>...HEAD` plus untracked/uncommitted files) and the surrounding modules it interacts with. Treat the author's summary as an unverified claim, never as truth.

## Attack Surfaces

1. **Correctness & edge cases:** off-by-one errors, null/undefined/empty inputs, swapped relation or polymorphic sides, stale caches, silent partial failures, unhandled error paths, mutation of caller-owned inputs during async work.
2. **Security, auth & tenant boundaries:** privilege escalation, missing or bypassed permission checks, cross-tenant data leaks, spoofing holes, unvalidated external input, unbounded work/DoS, secret leaks in responses or logs.
3. **Data integrity & concurrency:** races across concurrent requests/jobs, check-then-act outside a transaction or lock, non-atomic multi-step writes, soft-delete leaks, stored-value or schema changes missing a migration/port note.
4. **Contracts & callers:** signature changes with stale callers, tests, types, or docs; swallowed errors (`catch` without rethrow or real state action); unintended behavioral changes.
5. **Parallel machinery & cutouts:** new code duplicating an existing primitive or bolting an invariant-bypassing cutout onto a primitive instead of fixing the general rule.
6. **Stale plumbing & superseded invariants:** after an architectural change or refactor round, surviving fallbacks, double-checks, dead branches, wrappers, routes, or tests left over from the previous design. Never ask the author to *harden* a superseded or unreachable path — flag it as a blocking deletion instead.
7. **Style & structural consistency (`docs/standards/CODE_STYLE.md`):** enforce consistent style across every touched file — flat controller-style early exits (no nested `if`/`else` pyramids or nested ternaries), step-by-step readable decomposition (no dense monolithic multi-phase functions), atomic files, `lodash-es` over hand-rolled object-transform loops, direct throws with no Go-isms (`{ ok }` unions / `*OrThrow` twins / redundant pre-checks), and zero narrating comments.
8. **Tests & verification:** tests that mock away real behavior, assertions that pass trivially, untested failure paths, or unrun checks.

## Rules

- **Prove every blocking finding.** Cite exact `file:line` and show a concrete trace, failing input, or reproduced test/command output.
- **Distinguish defects from intended behavior.** When an effect is the explicit, intended outcome of a requirement the user specified, do not flag it as a bug or reopen the design; note it only if it is undocumented or violates a separate invariant.
- **Keep style consistent.** Style consistency is a first-class readability requirement, not a nitpick — flag violations of `docs/standards/CODE_STYLE.md` cleanly.
- **Separate severity cleanly:** `Blocking` (must fix before landing) vs `Non-blocking` (optional hardening or follow-up).

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Blocking Findings:** numbered list — title, `file:line`, concrete proof/reproduction, minimal fix.
3. **Non-Blocking Findings:** concise bullets if any.
4. **Confirmed Clean:** 2–4 bullets naming what you explicitly checked and verified safe.
