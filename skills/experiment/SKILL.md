---
name: experiment
description: >-
  Use before designing, reviewing, running or reporting ANY Warden or Foundry experiment — an eval run, an A/B, a model or charter round, a size or language test, anything that spends model calls to answer "is X better than Y". Six gated steps (design with pre-registration → adversarial review → tiny test → serial run → report in the reporting standard → finding record) and one rule over all of them: an experiment records results; it never writes a decision.
---

# Experiment pipeline

**Canonical copy:** `@inixiative/config` (`skills/experiment/`), materialized into `.claude/skills/inixiative-experiment/` by `inixiative-config standards`. Edit in `inixiative/config`, never in a consumer repo.

Aron, 2026-10-15: "I think we need to make an experiment pipeline. Again the results report style. Maybe make some skills for this so you don't have to keep fucking up." And: "Don't assume any of that. Design an experiment, run an adversarial against the experiment, and then run the experiment." "Before you start changing docs, this is the experiment."

Two mistakes this exists to stop (`~/code/inixiative/FEEDBACK-LOG.md`):
- **Row 40, untested optimisations justified by estimates.** Routing was built on a 0.8%/trigger cost estimate; measured 0.11%, 7× wrong, and routing lost more than half the hits.
- **Recording hypotheses as decisions.** Results of one run were written into CLAUDE.md, doc standards and builder defaults as if Aron had decided them. He decides; experiments report.

A measurement too small for this pipeline (a timing check, a "does it work" run, a size curve) is a **probe**: use the [`probe`](../inixiative-probe/SKILL.md) skill, which records it in one standard shape with the machine's load, and never changes a default.

Templates beside this file: [design.md](design.md) (pre-registration), [review.md](review.md) (adversarial checklist), [finding.json](finding.json) (schema: `~/.foundry/evals/findings/README.md`, mirrored in `oracle/docs/findings/README.md`). Worked example of steps 1–2: `~/.foundry/evals/experiments/2026-10-15-recogniser-granularity.md` and its `.review.md` (verdict REVISE: gate 1 would have passed an arm losing half the baseline's hits).

## Rules over every step

- **Quota.** The five-hour window counts every agent on the account; agents are the main spend (ten concurrent Opus/Fable agents cost more than the evals: 0.11% → 0.4–0.58% per eval moment while they ran). At most **3 agents** at a time, serialized. **Measure first:** record the window % at the start and end of every eval run and every long agent. From the Foundry checkout (a read of the login's usage, no model call; a window the CLI does not report is left out):
  `bun -e "import {claudeLimits} from './packages/foundry/src/providers/decision-host'; const s = await claudeLimits(process.cwd()); console.log(s && Object.fromEntries(s.windows.map((w) => [w.id, w.usedPercent])))"`
  (The charter eval that wrote `<out>/quota.jsonl` itself is parked in Oracle `migration/foundry-pool-evals/` and does not run.)
- **Cost is measured, never estimated into a decision.** An estimate sizes a ceiling; only the run's measured cost may justify a change.
- **Checks take the lock.** One full check at a time on the machine, inside a time limit and a memory ceiling: plain `bun run check` (the script runs the repo's chain, `check:all`, through `inixiative-config bounded`, which takes `~/.foundry/check.lock`; never wrap it in `lockf`, and never run `check:all` as the full check). Never `--no-verify`.
- **Private data stays private.** Fixtures, answers and runs live under `~/.foundry/evals/` (never in a repo); finding records carry numbers, set names and run ids only.

## 1. DESIGN — pre-register (gate: every section filled)

Copy [design.md](design.md) to `~/.foundry/evals/experiments/<date>-<name>.md` and fill every section before any model call:

- **Question** in Aron's words (quoted, dated); say if the run answers only a proxy.
- **One variable**; list what is held fixed.
- **Arms**, including a control for each confound.
- **Fixtures** with n, period, selection rule, and a plain-language **power statement** ("detects a collapse from X to Y, not a 10-point difference"; effective n when cells cluster in moments).
- **Baseline = floor:** a named run; lost hits bounded (lost − gained ≤ a small number), no region with a baseline hit falls to zero; a repeat of the baseline for the noise floor.
- **Gates** written now, before any run. An assumed benefit needs a pre-registered materiality threshold and a measurement in this run.
- **Cost ceiling and stop rules** on **warm** calls (cold prefix writes reported apart); estimate from per-call parts (cached read, suffix write, output).
- **Provenance** pinned by **content hash** (regions files, charters, fixtures, labels), not by a commit that may not contain them.
- **What would make the result wrong.**

**Decisions companion (optional): `<design>.decisions.md`.** Values that are filled after the review (run pins such as CLI version, image digest, runner commit, fixture hashes, the exact command; answers Aron still owes) go in a companion beside the design, so the design's hash, which the review pins, stays fixed. The design pre-registers every branch those values can take and names the companion. Write each unknown as `TBD`; when one is filled, add a dated line under the companion's `## Log` (the gate skips the Log, and a mention of the token quoted alone in backticks, so prose can name it). The companion is not reviewed by hash, but changing a pre-registered pin is a recorded deviation (log + report).

## 2. ADVERSARIAL REVIEW (gate: `verdict: go` for this exact design)

A **separate** agent (Opus 5.5, read-only, no model runs; one agent, counted in the three) reviews the design against [review.md](review.md)'s fixed checklist: answers the question or a proxy; one variable; confounds; gate looseness (computed from the baseline's own numbers); assumed vs measured benefit; power; cost realism; duplication of existing tooling, runs or findings; premature optimisation; results vs decisions. It writes `<design>.review.md` beside the design with `verdict: go` or `verdict: revise` and `design-sha256: <shasum -a 256 of the design>`.

On `revise`: change the design, then review again. Editing the design after a `go` invalidates it (the hash no longer matches).

## 3. TINY TEST (gate: feasible)

2–3 moments, few regions, every arm. Record window % before and after. Check parse errors, warm cost per moment against the estimate, and that the output maps to the report. **Stop** an arm that is infeasible (warm cost > 2× estimate, parse errors > 5%, or its tiny test misses what the baseline hits); don't run a wide test on it. Stop the experiment if every arm is infeasible. Up to three moments run without `--experiment`.

## 4. RUN (gate: the eval scripts enforce it)

Arms run **serially**, within the cost ceiling, with `--pause-at <n>` on the five-hour window, `--session <key>` per arm, and the window % recorded per arm. Halt at ≥ 90% of the seven-day window.

The eval scripts refuse a wide run (more than three moments, or a `--classify` run of more than one stage; the size test's `warden-size.ts run` always did, and is parked in Oracle `migration/foundry-pool-evals/`, not runnable) unless `--experiment <design.md>` names a design whose sections are filled and whose review says `verdict: go` with a matching `design-sha256` (foundry-core `feedback/experiment-gate.ts`, which Oracle's replay runner calls too). When `<design>.decisions.md` exists, the gate also refuses while it still holds a `TBD` value outside its `## Log`. The design's path and hash, and the companion's when there is one (`decisions`, `decisionsSha256`), land in `<out>/experiment.json`. Do not work around the gate: a refusal means step 1 or 2 isn't done.

## 5. REPORT — the reporting standard

Every run emits `report.json` + `REPORT.md` (the report tool `warden-charter-report.ts` is parked, with the charter eval, in Oracle `migration/foundry-pool-evals/` until the eval runner is rebuilt on the project host; schema in Oracle `docs/foundry/EVAL-REPORTING.md`). Per stage (recognise → confirm/pick → deliver → chorus roll-up):
- effectiveness, cost (exact tokens primary; window points as a shared upper bound), time (warm and cold, p50/p95);
- per-Warden miss and false-positive rates, each with n and a CI;
- accumulated (chorus) error with the compounding line;
- provenance (the hashes from step 1);
- deltas against the **named baseline**, paired where the cells are the same.

Read results against "mostly right" (per moment, coverage and majority-correct both > 0.5) and per-Warden precision/recall, not chorus-level "any wrong yes". Say plainly what was not measured.

## 6. FINDING RECORD

Generate one record per arm from `report.json` (fill [finding.json](finding.json) from the report by hand; the report tool's `--finding` is parked with it in Oracle `migration/foundry-pool-evals/`, not runnable). Write it to `~/.foundry/evals/findings/<date>-<name>.json`, then copy it to `oracle/docs/findings/` (numbers only; check no session text) and add a paragraph to `oracle/docs/WARDEN-EXPERIMENTS.md`.

## 7. WHAT DOES NOT CHANGE

No doc standard, builder default, Foundry default, setting or CLAUDE.md "decision" is written from an experiment. Results are recorded as results: the report, the finding record, and at most a line in CLAUDE.md or the plan marked **measured** with the finding's path. Recommend in the report; **Aron decides**, and only his decision is written as a decision (with his words and the date). A hypothesis stays labelled "UNDER EXPERIMENT, not decided" until he says otherwise.
