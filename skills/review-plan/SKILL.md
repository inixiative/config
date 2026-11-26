---
name: review-plan
description: Use before writing code on any semantic, architectural, or multi-file change to review the plan, 10-line prose flow, diagram, and primitive bridge analysis against prior decisions, existing primitives, and engineering doctrine.
---

# Pre-Coding Plan & Bridge Review

Review a proposed plan **before code is written** (`docs/standards/ENGINEERING_DOCTRINE.md` §3, §5, §6). Catching a wrong premise or missed primitive on a 10-line plan costs two minutes; catching it after implementation costs a rewrite.

## Checklist

1. **Clear "why", plain prose, and a concrete code specimen:**
   - Can the plan state the purpose in one sentence, walk the end-to-end flow in ~10 lines of plain prose, **and show a 20–40 line concrete code specimen** ("what is it going to look like?" — the actual data shape, schema, registry, or call site, plus a Mermaid or Blueprint "but… so…" diagram for multi-step mechanisms)?
   - Abstract prose hides bloat that becomes obvious in 15 seconds on a 30-line code shape. If the specimen or mechanism is missing or hand-waved, stop and write it before coding.
2. **History & prior rulings check:**
   - Does the plan contradict any standing decision, `CLAUDE.md` rule, repo doc, or prior git history? Name any conflict explicitly.
3. **Primitive map & bridge analysis:**
   - For every concern touched (auth, permissions, DB access, requests, locks, jobs, events, errors, settings, UI), does the plan name the existing primitive and its path?
   - For every `"new"` decision, does the bridge analysis show what was tried on the closest existing primitive and why extending/composing it fails? Reject `"doesn't match exactly"`.
   - If the plan overrides or bypasses an existing system without explicit user acknowledgement, block and flag the question to ask.
4. **Premise smell & cutouts:**
   - Does the plan introduce a new flag, bypass option, special-case mode, or second path to paper over a mismatch? Name the underlying premise flaw instead.
5. **Scope calibration (overbuild vs. underbuild):**
   - Flag invented scope nobody asked for *and* incomplete foundations that would force an immediate v2.
   - Flag forks that depend on unstated user intent — list the concrete question(s) to ask rather than guessing.
6. **Subtraction challenge:**
   - Pair with `review-subtractor` to test whether 30–50% of the proposed routes, stores, middlewares, or files can be collapsed before writing line 1.

## Output Format

1. **Verdict:** `APPROVE` or `REQUEST_CHANGES`
2. **Blocking Plan Gaps / Premise Flaws:** concrete issues to resolve before writing code.
3. **Open Questions for the User:** only genuine forks that cannot be inferred from existing rules/code.
4. **Suggested Collapses:** any proposed new pieces that can fold into existing primitives.
