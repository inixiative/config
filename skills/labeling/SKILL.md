---
name: labeling
description: Use whenever you name or label work someone will scan later — a thread title, a subagent or background-agent description, a background command's label, a Running/process label, a PR title, a branch name, a commit subject, a coordination-board row, a toast or action label. Makes every label say the outcome in a few plain words so a person scanning a list knows what each thing is without opening it.
---

# Labeling work

Labels are read in lists: the thread rail, the Running panel, the Board, `gh pr list`, COORDINATION.md. A good label lets Aron scan twenty of them and know what each one is, where it lives and whether it's his concern, without opening anything.

Why this matters: unclear labels ("Build remaining items", "fix stuff", "New thread · 11:52") force a click to find out what something is, and in a list of parallel agents that costs more than the work.

## The rules

1. **Name the outcome, not the activity.** "Turn view: timeline endpoint", not "Working on backend". "Archive: redact personal notes", not "Redaction pass".
2. **Lead with where it lives** when the list mixes repos or areas: `area: outcome`. Skip the area when the list is already scoped to it (a project's thread pane doesn't need the project name).
3. **3–7 words, one line, no trailing punctuation.** If it needs a second clause, the second clause belongs in the description, not the label.
4. **Plain words, full names.** No internal ticket letters alone ("item Q"), no abbreviations a reader must decode; ticket ids go after the words: "Watchtower by stage (S)".
5. **Distinguish siblings.** Labels that sit side by side must differ in their first three words. Two "Fix viewer" rows is a failure.
6. **Say the state in the status field, not the label.** "Done", "WIP", "blocked" never go in a title; the list shows state with its own colour and icon.
7. **Keep it stable.** Rename only when the outcome changed, not to report progress.

## Per kind

| Kind | Shape | Example |
|---|---|---|
| Thread title | `outcome` (area only outside a project) | "Lift owner-only thread view" |
| Subagent / Agent `description` | `area: outcome`, 3–5 words | "Foundry: turn timeline API" |
| Background command label | what it is, then where | "API server · :3502", "Grant tests (watch)" |
| Running / process row | label above, exact command below | label "Typecheck", command `bunx tsc --noEmit -p apps/api` |
| PR title | conventional prefix + outcome | `feat(viewer): turn view — a turn as a timeline` |
| Branch | `type/area-outcome`, kebab | `feat/viewer-turn` |
| Commit subject | imperative outcome, ≤ 72 chars | "Delete the unwired Planner agent" |
| COORDINATION row | `session: outcome (Aron, date)` | "inixiative-cd (backend): viewer data APIs" |
| Toast / action | verb + object, past tense for results | "Merged into “Cart refactor”" |

## Check before you commit a label

- Could Aron tell what it is from the label alone, in a list of twenty?
- Does it differ from its siblings in the first three words?
- Is any state, progress or apology word in it? Remove it.
