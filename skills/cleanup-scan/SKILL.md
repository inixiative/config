---
name: cleanup-scan
description: Use after finishing a piece of work and before pushing it (the cleanupScanGate hook refuses `git push` until this has run on HEAD). Orchestrates the full `adversarials` 4-pass review suite (duplication, naming/vocabulary, correctness/security/style, architectural subtractor) plus recurring feedback checks, in-flight collision checks, doctrine drift, template parity, and leftovers, fixes what it finds, then records the scan.
---

# Cleanup Scan

## Why

Work sprawls faster than anyone reviews it: a helper that already exists, loose synonym drift, a second auth path, stale plumbing left behind after a refactor, or a port landing on code another branch is deleting. Every one of those is findable before pushing. Running the full `adversarials` suite plus repo hygiene checks catches them automatically before review.

Scope is the outgoing diff: `git diff origin/<default-branch>...HEAD` plus anything uncommitted. Fix what you find in the code, re-run the checks, then record.

## 1. Duplicates and parallel machinery (`review-dedupe`)

Before anything the diff adds counts as new, prove nothing already does its job: in this repository,
in sibling forks, in standard utilities (`lodash-es`), and in the `@inixiative/*` libraries it touches.

- Inventory first by concept, not only by name: search the whole repo, sibling repos, and lower libraries (`docs/VERBS.md` and `src/`).
- "It doesn't fit" needs evidence: express the case on the existing primitive and run it, with output. A subagent's "nothing fits" is a claim until you reproduce what it rests on.
- A new thing next to an old thing that does the same job is parallel machinery. Use or extend the existing one and delete the new one. If neither fits, the diff must show why and the bridge you tried.
- The same job done in two repositories: one owns it, the others consume it.
- When you change a signature, follow the old one everywhere: callers, tests, docs, examples, tickets.

## 2. Vocabulary and naming consistency (`review-naming`)

Every file name, type, function, variable, field, route, export, test title, and doc term added or changed is audited against `docs/standards/NAMING_VOCABULARY.md` (and repo-local `NAMING.md` / `docs/VERBS.md` where present).

- **Within-diff synonym drift:** verify every core concept uses one exact domain noun and verb across files, types, variables, tests, and docs — never mixing loose synonyms.
- Look up the vocabulary first: the verb table, the field vocabulary, the side names, and the library's `docs/VERBS.md`. Use the established term; add a row only when an operation is genuinely new, and say so in the PR.
- Read each name as a short sentence: rename anything cryptic, mechanism-focused, metaphorical, or misdescribing what it does.
- Retired names stay retired: old terms never return in code, tests, or docs.

## 3. Base correctness, security & style consistency (`review-adversarial`)

A separate agent tries to break the change before it reaches the user: wrong behavior, swapped sides, open permission or tenant boundaries, races, data loss, contract drift, or inconsistent style (`docs/standards/CODE_STYLE.md` — flat early exits, no nested ternaries, step-by-step decomposition, atomic files, `lodash-es`, no Go-isms, zero narrating comments). Give it the code and the claim, not your conclusion. Fix what it confirms; reproduce anything it reports before relaying it.

## 3.5. Architectural Subtractor & Stale-Plumbing Sweep (`review-subtractor`)

Distinct from §1 (code-level duplicates) and §3 (correctness/security/style): a separate agent reads the **whole** plan or diff — plus every surviving file in the touched subsystem — with an explicit deletion mandate: *assume this has 30–50% too much surface area and left old plumbing behind; cut it down and delete every superseded layer without losing required behavior* (`docs/standards/GREAT_PROGRAMMER.md`).

- **Checkpoints (never skip later rounds):** run it **before coding** (on the 10-line prose flow and diagram), **before merge** (on the full outgoing diff), and **again after every architectural or refactor round before pushing**.
- **Stale-plumbing & surviving-parts reassessment:** for every invariant or mechanism introduced or replaced by a refactor, trace the superseded mechanism across the **entire touched subsystem** (not just lines in the latest commit). Delete every fallback, helper, wrapper, branch, guard, column, route, test, and doc that only existed before the new invariant held, and reassess whether every surviving part still needs to exist.
- **Primitive absorption:** for every new file, route, column, store, flag, or wrapper, ask: *can an existing primitive in this repo or its core libraries absorb this directly?*
- **Fresh-eyes rebuild:** ignore sunk cost from earlier iterations; cut any layer that only exists to patch an earlier design turn.
- **Cutout elimination:** reject bypass options or escape hatches bolted onto a primitive to accommodate a clumsy caller; fix the general rule instead.

## 4. The reviews asked for most

Each comes from recurring process corrections (`~/code/inixiative/FEEDBACK-LOG.md`):

- **Overbuild and underbuild:** surface that earns nothing goes; a foreseen foundation need is built whole.
- **Defensive-code theater & Go-isms:** no `{ ok }` result unions + `*OrThrow` twins, no catch-and-rethrow, no hand-built errors the boundary already maps, no re-checking a library's contract; a guard lives once, in the primitive.
- **Special cases:** a carve-out for one input is a missing general rule. Restate the case another way; if it behaves differently, fix the rule.
- **Backwards compatibility:** none (pre-users). No aliases, dual-accept, or transitional code; a one-off data fix is a throwaway script.
- **The why:** every doc, plan, and PR states the problem it solves and the evidence that chose it.
- **History first:** before a design, search what was already decided (rulings ledger, git log, docs).
- **Backport:** a template change names how downstream forks get it, including any stored value that must change.

## 5. In-flight collisions

- Check open PRs (`gh pr list --state open`) and unmerged remote branches (`git branch -r --no-merged origin/<default-branch>`): diff overlapping files and read them.
- A branch that deletes, replaces, or rewrites what you changed means your work may target code that is going away. Stop and coordinate before pushing.
- In a fork, also check template's open PRs for the same concern rather than inventing a local version.

## 6. Doctrine drift

Re-read the repo's doctrine entrypoint and domain docs for every area the diff touches, then check the diff against them. Fix violations rather than relitigating rules.

## 7. Template parity (forks only)

For each changed file that also exists in template, diff it against template's default branch. A difference must be intentional; when it isn't, match template (or fix template if template is wrong).

## 8. Leftovers

Unused imports and exports, dead files, stale docs and comments, baselines or exemptions the change made unnecessary, debug output, files the change made obsolete, and any superseded fallbacks, helpers, branches, guards, routes, or tests left standing after an architectural change.

## 9. Verify and record

1. Commit the fixes.
2. Record the scan of the exact commit you will push:

```bash
bun run cleanup-scan:record
```

It refuses an uncommitted tree, runs `bun run check`, and records HEAD only when the check passes and the checkout did not change while it ran. A failure that predates the change is shown on the default branch, not assumed.

The gate compares that file to HEAD, so any later commit needs a new scan. In the report, name what each step found and fixed, or that it found nothing.
