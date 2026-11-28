---
name: probe
description: Use before running ANY quick measurement of Foundry, Chorus, agent-session or a Warden host that is too small for the full experiment pipeline — a timing check, a "does this even work" run, a load or cache probe, a curve over sizes. Gives every such run one record shape (what ran, on what versions, under what machine load, what it measured) written to one place, so results compare over time. Use the `experiment` skill instead whenever the run answers "is X better than Y" for a decision, spends more than a few dollars, or needs a design review.
---

# Probes: small measurements, recorded the same way every time

**Canonical copy:** `@inixiative/config` (`skills/probe/`), materialized into `.claude/skills/inixiative-probe/` by `inixiative-config standards`. Edit in `inixiative/config`, never in a consumer repo.

Aron, 2026-11-19: "We should make some standard things: how we test things, what the load was throughout the test, and whether we're tracking it… We should have a standard way of doing experiments and recording them so that we can compare over time and we're not just doing them ad hoc." Why: on 2026-11-18/19 a dozen probes ran ad hoc at machine loads from 40 to 350; their numbers sat in a scratch folder and a chat, some were unreadable because of the load, and none could be compared with the next day's.

A probe **records a result and decides nothing**. It is the small tier below the [`experiment`](../inixiative-experiment/SKILL.md) skill, and shares its rules: Aron decides; private text stays under `~/.foundry/evals/`; at most 3 agents on the account; never work around a gate.

## When it is a probe, and when it is an experiment

A probe: one question, minutes not hours, a cost you can state in advance and that stays under about $3 at list prices, no fixtures drawn from sessions, no accuracy claim. Anything else, or anything whose result would be used to choose between designs, is an experiment: design, adversarial review, tiny test, serial run.

A probe may show that something works, breaks, or roughly how long it takes. It may not be the reason a default changes; it is the reason to run the experiment.

## 1. Before: write the question and the baseline

In `~/.foundry/evals/probes/<date>-<name>/README.md`, before the first call:
- **Question**, in one sentence (Aron's words, dated, if he asked it).
- **What varies** and what is held fixed.
- **What would count as an answer**, written now ("held again in under 5 s", "errors or not").
- **Cost ceiling** and how it was estimated.

Then run the **standard baseline** once, first, in the same session: 32 synthetic Wardens in today's host layout, two reloads (`bun scripts/diagnose-setup.ts --roles 32 --dispatchers 4 --builders 1 --charter --rounds 2` in agent-session). Its numbers say whether this session is comparable with earlier ones: if its setup or reload time is more than 1.5× the last quiet baseline, say so in the record and treat every timing in the session as an upper bound.

## 2. During: one run at a time, with the machine recorded

- **Runs go in sequence**, never beside each other or beside a full check, a live re-record or another eval of yours (Aron, 2026-11-19: "run these… in sequence, so they're not in parallel, taking up resources").
- **Sample the machine through every run**: `python3 ~/.foundry/evals/host-scaling/bin/sample.py <run>/machine.jsonl <pid>` (1-minute load, CPU of the run's own process tree and of everything else, every 2 s).
- **Record what the run itself felt**, not only the machine: per call, the time waiting on the model against the time in our own code, where the tool can tell them apart. A slow run is the model's, the machine's or ours; the record should let a reader say which.
- **Timestamps**: when the question is "parallel or in sequence", record events per second (answers, starts, holds), not only totals.

## 3. After: one record per run

Write `<run>/record.json` in this shape ([record.json](record.json)); numbers only, no prompt or answer text:

```json
{
  "probe": "<date>-<name>",
  "run": "<arm or size>",
  "question": "<one sentence>",
  "varied": { "<name>": "<value>" },
  "fixed": { "<name>": "<value>" },
  "environment": {
    "date": "YYYY-MM-DDTHH:MMZ",
    "machine": { "cores": 0, "load1": { "start": 0, "median": 0, "max": 0 }, "ownCpuPct": { "median": 0 }, "outsideCpuPct": { "median": 0, "max": 0 } },
    "versions": { "claudeCode": "", "agentSession": "", "foundry": "<commit>", "harness": "<commit or script hash>" },
    "models": ["<model id and effort>"],
    "login": { "sevenDayBefore": 0, "sevenDayAfter": 0 },
    "baseline": { "ref": "<this session's baseline run>", "setupMs": 0, "reloadMs": 0, "comparable": true }
  },
  "measures": { "<name>": 0 },
  "n": 0,
  "cost": { "listUsd": 0, "how": "<tokens priced at list rates | estimate>" },
  "notMeasured": ["<what this run cannot say>"]
}
```

`environment.baseline.comparable` is false when the session's baseline was off or the load during the run was more than twice the baseline's; such a run is reported with its numbers and the words "not comparable".

## 4. Report and file

- Say the result against what was written in step 1, with n, and what was **not** measured.
- Two runs are compared only when both are `comparable`; otherwise the comparison is stated as not readable.
- Add one dated line to `chorus/docs/HISTORY.md` (the question, the result with n, the record's path) and, when it changes what is true of the running system, to `chorus/docs/STATE.md`.
- A result that should change a design becomes an experiment: name it in `TRACKING.md` or start its design.

## What does not change

No default, setting, doc standard or CLAUDE.md line is written from a probe.
