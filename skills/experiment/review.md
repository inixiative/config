# Adversarial review: <fill: experiment name>

<!-- Copy beside the design as <design>.review.md. Written by a SEPARATE agent (Opus 5.5, read-only, no
model runs) that did not write the design. Worked example:
~/.foundry/evals/experiments/2026-10-15-recogniser-granularity.review.md -->

Reviewer: <fill: model, read-only>. Date: <fill>. Inputs read: <fill: the design, CLAUDE.md Foundry bullets, the plan, the baseline's report.json, the scripts named in Tooling>.

verdict: <fill: go | revise>
design-sha256: <fill: `shasum -a 256 <design>.md`; the gate refuses a design edited after this line>

## Checklist

Answer each one with a finding or "holds", and the evidence (file, number).

1. **Question or proxy.** Does the run answer Aron's question as he worded it, or a proxy? If a proxy, is that said in the design?
2. **One variable.** Does anything else move between arms (charter text, prompt wrapper, concurrency, cache warmth, regions text)?
3. **Confounds.** Is there a control for each confound the design names, and is one missing?
4. **Gate looseness.** Can an arm pass while losing a large share of the baseline's hits? Compute it from the baseline's own numbers.
5. **Assumed vs measured benefit.** Is any reason for the change (cost, memory, speed, fewer sessions) assumed rather than measured in this run? Is there a materiality threshold?
6. **Power.** Can n detect the effect the gates care about? Are cells really independent? Is the noise floor measured?
7. **Cost realism.** Is the estimate built from per-call parts, on warm calls? Will the stop rule kill the baseline on the tiny test's cold writes?
8. **Duplication.** Does tooling, a run, or a finding record that already exists answer this or part of it?
9. **Premature optimisation.** Is this optimising something not yet shown to bite? (FEEDBACK-LOG row 40.)
10. **Results vs decisions.** Does the design promise to change a doc standard, builder default, Foundry default or CLAUDE.md line on its own? It must only report.

## Ranked problems

<fill: CRITICAL / HIGH / MEDIUM / LOW, each with Why and Fix.>

## Minimal changes before running

<fill: numbered list; empty when the verdict is go.>
