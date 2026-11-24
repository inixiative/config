# <fill: experiment name>

Status: design, not run (<fill: date>). Layer: <fill: region-shape | corpus | recognition | selection | model | delivery | cost>. Finding record: `~/.foundry/evals/findings/<fill: date-name>.json`.

<!-- Copy to ~/.foundry/evals/experiments/<date>-<name>.md. Replace every <fill: …>; the gate refuses
a wide run while one remains. Values only known after review (run pins, owed answers) go in a
<date>-<name>.decisions.md companion beside this file, written TBD until filled; the gate refuses while
any TBD remains (SKILL.md step 1). Worked example: ~/.foundry/evals/experiments/2026-10-15-recogniser-granularity.md -->

## Question

<fill: Aron's words, quoted, with the date. Then the question this run answers in one sentence. If the run can only answer a proxy, say which proxy and why it stands in.>

## Variable

<fill: the ONE thing that differs between arms. List what is held fixed: model, effort, charter, region text, moments, stage 2, concurrency.>

## Arms

<fill: table — arm | value of the variable | what it costs per moment (estimate built from per-call parts: cached read, suffix write, output) | note. Include a control arm when the variable has a confound (e.g. random grouping vs concept grouping).>

## Fixtures and power

<fill: set path, period (train | test | synthetic), n positives / n negatives, how they were selected (never from past answers). Power in plain words: "with n cells this detects a drop from X to Y; it does not resolve a Z-point difference." Name the effective n when cells cluster inside moments.>

## Baseline

<fill: the named baseline run (id, regions hash, charter, model). It is a floor: state how many of its hits an arm may lose (bounded, e.g. lost − gained ≤ 1) and that no region with a baseline hit may fall to zero. Name the run-to-run noise floor (a repeat of the baseline) or plan one.>

## Gates

<fill: the pass/fail rules, written now, before any run. Each gate is a number with n. Say which result means "keep the baseline". A benefit that is assumed (cost, memory, latency) must be measured in this run against a materiality threshold stated here, or it is not a reason to change anything.>

## Cost ceiling and stop rules

<fill: window points per arm and in total; estimate from per-call parts on WARM calls (cold prefix writes reported apart). Tiny test first (2–3 moments, few regions): window % before/after. Stop an arm when warm cost > 2× estimate or parse errors > 5%. --pause-at <n> on the five-hour window; halt at ≥ 90% of the seven-day window. ≤ 3 agents on the account while it runs.>

## Provenance

<fill: content hashes of everything the run reads — regions set (hash of the files, not a commit that may not contain them), charter file(s), fixtures file, labels; Foundry commit of the eval scripts; model ids and effort.>

## What would make the result wrong

<fill: the confounds, leaks and measurement errors that could fake a pass or a fail, and the control or check for each (position effects, cache warmth, shared window noise, label errors, text still moving under the run).>
