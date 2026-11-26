# Release conductor

One agent runs every release train. It is a Foundry schedule on the config project: each run is a new thread that starts from this file and the queue, does the release, and ends. A run that is still going makes the next due time skip, so there is never more than one.

Why (Aron, 2026-11-26, R-2026-11-26-03): releases kept waiting on whichever lane session remembered them. A config PR sat unmerged for two days after its session moved on; a published signet was never recorded until another session's train found it; an agent-session release sat unpublished for a day. A train also takes hours on a busy machine, and a lane session should not spend its context waiting for one.

## What a lane session does

A lane session stops at "merged, row written". It:

- merges its own package change, with the version bump, once its check is green (its lane's merge rules still apply);
- opens a config PR when the release needs one (a new package, a lane change, a hold) and leaves it open;
- adds a row to `~/code/inixiative/RELEASE-QUEUE.md` saying what, why and what it needs.

It never runs `train` and never merges a config PR. Why: the train pushes config `main` when it ends, so anything that lands there while it runs breaks that push after the train has already published.

## What a run does, in order

1. **Is there work?** Read the queue, `gh pr list` on config, `versions.json` and `train --dry-run`. Nothing queued, nothing ahead of npm, no adoption branch waiting: end the run in one line.
2. **Merge queued config PRs.** Green ones only: merge `main` in, run `bun run check`, merge. One that is red or conflicts goes back to its owner (below).
3. **Run the agentic train.** `bun src/cli.ts train ~/code/inixiative --lane=agentic --dry-run`, read the plan, then the same with `--push` in place of `--dry-run`. The agentic lane needs no ask (R-2026-11-20-02).
   Then read its summary for what it could not do, and finish each:
   - **A rejected push** (a repo's `main` moved while the train ran). The train stops pushing at the first one, so every repo after it is unpushed too. In each repo ahead of origin: push; where it is rejected, rebase the train's commits onto origin, run the full check, push.
   - **A skipped checkout** (dirty or diverged). Untracked files that belong to no session's work, such as tool logs, are a queue row to get them ignored; anything else is its owner's, so message them.
   - **A failed install.** In a template-based repo run `scripts/setup/sync-env.sh` first: a missing env key fails `postinstall`.
4. **Finish adoptions.** For each incomplete adoption branch the summary lists, make the mechanical fix, run that repo's full `bun run check`, merge once green, then run the train again so it blesses.
5. **Primitives rows.** Run `train --lane=primitives --dry-run` only. Put its plan on the row, set the row to `waiting on Aron`, and ask with `set_status needs-you`. Run the real lane only after he says so in that thread.
6. **Update the queue.** Set each row's state. Delete a row once its version is blessed and every repo that depends on it is on it.
7. **Report.** End with what was blessed, what is still a candidate and what holds it, and what was handed back.

## What it may fix

Only what an adoption mechanically needs:

- re-locks and `@inixiative/*` range rewrites;
- re-recorded cassettes (`train:adopt`);
- an import, type or call site that follows a rename or a changed signature in the adopted package, when the adopted package's changelog or diff names the new form.

Anything that changes what code does is not the conductor's: a failing test whose expectation would have to change, a behaviour difference, a schema change, a design choice. It hands that back.

## Handing back

Set the row to `handed back`, with the failing command and the first failing lines. Message the owner session named on the row (`ListAgents`, `SendMessage`). When the row has no owner or the session is gone, set `needs-you` and say what is stuck. A handed-back row holds only its own package: the train still blesses everything else.

## Rules that hold in every run

- The full check on the exact commit before anything merges; never `check:all` on this machine.
- Never bypass a hook, force-push, or use `git stash`.
- Never print a secret. A publish that asks for a one-time code is a `needs-you`.
- Template gets only the train's own re-lock commit. Any other template change is a PR for Aron.
- A Kingdom re-lock deploys api and worker from `main` by itself; deploy web, admin and superadmin to Vercel when the re-lock moved a package they import.
- Check `~/code/inixiative/COORDINATION.md` before touching a repo another session holds, and note the train there while it runs.

## The queue

`~/code/inixiative/RELEASE-QUEUE.md`, one row per change:

| Column | Holds |
|---|---|
| Added | the date |
| Owner session | who to hand back to |
| Lane | `agentic` or `primitives` |
| What | the package and version, or the config PR |
| Why | the problem it solves |
| Needs | what must happen for it to be done |
| State | `queued`, `on train`, `handed back`, `waiting on Aron` |

The queue holds what the train cannot find by itself. A version already on npm, a candidate and an adoption branch are all found by `train`; a row for one of those exists to carry its owner and its why.
