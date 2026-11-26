---
name: review-plan
description: Use before writing code on any semantic, architectural, or multi-file change to review the plan, 10-line prose flow, 20-40 line code specimen, diagram, primitive bridge analysis, and competing premises against prior decisions and engineering doctrine.
---

# Pre-Coding Plan & Bridge Review

## Why

Catching a flawed premise, missing primitive, or bloated abstraction on a 10-line plan and a 30-line code specimen takes two minutes; catching it after implementation costs hours of rewrite and review. Abstract prose makes bad designs sound reasonable — concrete shapes and competing edge cases expose holes immediately (`docs/standards/ENGINEERING_DOCTRINE.md` §3, §5, §6; `docs/standards/GREAT_PROGRAMMER.md` Principles 4, 7).

## Checklist

1. **Clear "why", plain prose, and a concrete code specimen:**
   - Does the plan state the purpose in one sentence, walk the end-to-end flow in ~10 lines of plain prose, **and show a 20–40 line concrete code specimen** ("what is it going to look like?" — actual schema, type shape, registry, or call site, plus a simple diagram for multi-step mechanisms)?
   - If the specimen or mechanism is missing or hand-waved, stop and write it before coding.
2. **Symmetrical premise check (when an assumption is in doubt or options compete):**
   - Put the current premise and the alternative on equal footing: name both plainly, trace at least one hard concrete user intent for each without hand-waving over gaps (the holes are the point), compare the machinery delta, and check for self-inflicted objections caused by another assumption in doubt. Argue strictly from exposed holes and trade-offs, never sunk cost (`GREAT_PROGRAMMER.md` Principle 7).
3. **History & prior rulings check:**
   - Does the plan contradict any standing decision, `CLAUDE.md` rule, repo doc, or prior git history? Name any conflict explicitly.
4. **Primitive map & bridge analysis:**
   - For every concern touched, does the plan name the existing primitive and its path?
   - For every `"new"` decision, does the bridge analysis show what was tried on the closest existing primitive and why extending/composing it fails? Reject `"doesn't match exactly"`.
   - If the plan overrides or bypasses an existing system without explicit user acknowledgement, block and flag the question to ask.
5. **Premise smell & cutouts:**
   - Does the plan introduce a new flag, bypass option, special-case mode, or second path to paper over a mismatch? Name the underlying premise flaw instead.
6. **Scope calibration (overbuild vs. underbuild):**
   - Flag invented scope nobody asked for *and* incomplete foundations that would force an immediate v2.
   - Surface genuine user-intent forks as concrete questions rather than guessing.
7. **Subtraction challenge:**
   - Pair with `review-subtractor` to test whether 30–50% of the proposed surface area can be collapsed before writing line 1.

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Blocking Plan Gaps / Premise Flaws:** concrete issues to resolve before writing code.
3. **Open Questions for the User:** only genuine forks that cannot be inferred from existing rules/code.
4. **Suggested Collapses:** any proposed new pieces that can fold into existing primitives.
