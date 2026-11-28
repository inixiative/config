---
name: review-subtractor
description: Part 2 of the `adversarials` 4-pass review suite. Use whenever asked to run "adversarials", before coding (on a 10-line prose/diagram plan), before merge (on the full outgoing diff), and after every architectural or refactor round before pushing. Operates under an explicit 30-50% deletion mandate to collapse excess surface area into existing primitives, sweep stale/superseded plumbing across the whole touched subsystem, and reassess whether every surviving part still needs to exist.
---

# Architectural Subtractor Review

## Why

Iterative coding and review rounds naturally accrete locally reasonable layers — a wrapper here, a fallback there, an extra route or flag to patch an earlier turn — and architectural refactors routinely wire up a new invariant while leaving old plumbing alive beside it. Bug-hunting (`review-adversarial`) and line-level deduping (`review-dedupe`) rarely delete whole layers. Code is read 10×–50× more than it is written, so an explicit deletion pass is required to keep surface area small and honest (`docs/standards/GREAT_PROGRAMMER.md`).

**Starting premise:** assume this plan or PR has **30–50% too much surface area** and that any architectural change left superseded plumbing behind. Cut surface area and strip every dead layer without losing required behavior.

## Checkpoints

1. **Pre-coding (cheap):** review the 10-line prose flow, code specimen, and any diagram *before* code is written. Every new part must justify why the simpler design before it failed.
2. **Pre-merge & every architectural/refactor round:** read the *entire* outgoing diff **and** every surviving file in the touched subsystem fresh — ignoring sunk cost from earlier turns — on **every** push after an architectural or multi-file refactor round (never skip later rounds).

## Pass 1 — Stale-Plumbing & Surviving-Parts Reassessment

Whenever a change introduces a new invariant or replaces an earlier mechanism:

1. **Name every invariant or mechanism that changed** (old model → new model).
2. **Trace the old mechanism across the whole touched subsystem** — not only lines in the latest commit diff. Find every caller, fallback, defensive guard, obsolete helper, dead branch, column, DTO, route, wrapper, test, and doc that only existed before the new invariant held.
3. **Reassess every surviving part** in the touched area: *under the new architecture, does this part still need to exist?* If it was only load-bearing under the previous design, mark it as a blocking deletion.
4. **Never harden dead plumbing:** if a refactor round added guards or tests around a path the new invariant already makes unreachable or unnecessary, delete the path instead of polishing it.

## Pass 2 — Challenge Every New Piece

For every new module, route, table/column, store, flag, option, or wrapper:

1. **Primitive absorption:** which existing primitive in this repo or its core libraries already owns this job or can absorb it directly?
2. **Fresh-eyes rebuild:** knowing everything we know now, if we built this from scratch in one pass, would this piece exist? If not, cut it.
3. **One concept, one place:** is one rule or invariant enforced in two places? Collapse it to one structural site.
4. **Cutout elimination:** does this add a bypass flag, escape hatch, or special-case mode to paper over a caller mismatch? Delete the cutout and fix the general rule.
5. **Module depth & step-by-step readability:** does this module hide real complexity behind a clean interface, or is it either a shallow pass-through wrapper or a dense monolithic function that should be broken into clear step-by-step helpers?

## Rules

- **Never rubber-stamp.** Even on a clean diff, list the top 2–3 pieces (new or surviving) you tried to delete and why each survived (or didn't).
- **Show the collapsed shape.** Whenever proposing a deletion or collapse, state in 2–4 lines how the existing primitive or new invariant handles the case without losing any requirement.

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Superseded / Stale Parts Audited:** every changed invariant/mechanism traced across the touched subsystem, listing stale files, fallbacks, helpers, branches, routes, or tests to delete (or explicitly confirming none remain).
3. **Proposed Deletions / Collapses:** each with target path/concept, what replaces it, estimated surface reduction, and whether blocking.
4. **Tested & Survived:** the main new and surviving pieces you challenged and why they genuinely earn their keep.
