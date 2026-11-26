# Authoring Agent Skills

Shared standards for writing and editing `SKILL.md` files across all inixiative repositories.

## Why

A poorly written skill fails in two opposite ways: either it is too vague to change behavior, or it is stuffed with rigid rules and past-incident examples that make agents **overfit** — pattern-matching last week's bug while missing its cousins in other repositories. Explaining *why* a failure happens, paired with generic, actionable checks, lets the agent generalize cleanly to unfamiliar codebases and edge cases.

---

## 1. Lead With the Why

Start every skill body with a short `## Why` section (2–4 lines) stating:

- **What failure mode** this skill exists to prevent,
- **Why** normal execution or other passes miss it, and
- **What goes wrong** when it is skipped.

When an agent holds the *why*, it makes sound judgment calls on cases the skill never enumerated.

---

## 2. Generic, Actionable, and Free of Incident Overfitting

- **Distill the failure class, not last Tuesday's PR.** Never paste repo-specific stack lists or one-off incident anecdotes into a universal skill. If a rule came from a concrete bug, abstract it to the structural invariant that failed.
- **Keep examples sparse and structural.** Avoid laundry lists of examples — models anchor on surface tokens and narrow their scan to those exact shapes. Use an example only when a boundary would otherwise be genuinely ambiguous, and keep it minimal.
- **Make every bullet falsifiable and actionable.** Replace passive advice (*"be thorough"*, *"keep it clean"*) with a concrete test the agent can execute and report (*"list the top 2–3 surviving pieces you tried to delete and why each survived"*, *"prove every blocking finding with `file:line` and a trace"*).
- **Apply a holdout mental check.** Before finalizing a universal skill, ask: *if this runs tomorrow on a completely different repo (a pure TypeScript library, a CLI, a backend service), does every line still apply without referencing stack details that aren't there?*

---

## 3. Calibrate Degrees of Freedom to Fragility

Match instruction strictness to how fragile the task is:

- **High freedom (WHY + principles + rejection tests):** for judgment-heavy work (architecture, naming, code review, writing). Give the goal, the failure modes, and the verification bar; let the agent reason.
- **Medium freedom (patterns + structured output format):** for repeatable workflows where the shape of the deliverable matters (review verdicts, tables of findings, plan specimens).
- **Low freedom (exact commands or scripts):** only for fragile, deterministic gates where deviation breaks tooling or safety (lock-bounded checks, worktree scripts, scan recording).

---

## 4. Progressive Disclosure (Three Tiers)

Keep context footprints lean so skills trigger reliably and do not drown the working thread:

1. **Tier 1 — Discovery (`name` + `description` frontmatter):** always loaded into context. Make `description` crisp, third-person, and explicit about *when* to trigger — including exact user codewords (e.g. `"adversarials"`), since models tend to undertrigger.
2. **Tier 2 — Activation (`SKILL.md` body):** loaded only when the skill activates. Keep it focused and scannable (prefer under ~120 lines; never past 500 lines): `## Why`, the actionable workflow/checklist, hard rules, and `## Output Format`.
3. **Tier 3 — Execution (`references/`, `scripts/`):** optional deep-dive reference tables or deterministic scripts kept 1-level deep and loaded only on demand. Never put a `README.md` inside a skill directory.

---

## 5. One Concept, One Owner

- Do not duplicate a standard document inside a skill; link to `docs/standards/<DOC>.md` and keep the skill focused on the execution pass.
- Do not let overlapping skills contradict each other — if one standard requires consistent style, no review skill may tell agents to ignore style.
