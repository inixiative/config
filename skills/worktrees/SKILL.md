---
name: worktrees
description: Use when starting feature work that needs isolation, when dispatching subagents that will edit code, or when managing existing worktrees across any inixiative repository. Teaches worktree-only discipline, when to use repo `bun run worktree:*` slot scripts vs plain `git worktree`, and cleanup after merge.
---

# Worktrees

Never commit feature or fix work directly in a shared `main` checkout. Every repo has other sessions, daemons, or test runs reading its main checkout — work in an isolated worktree off `origin/main` and clean it up as soon as the branch merges.

## 1. Check whether this repo has slot worktree scripts

Inspect `package.json` for `worktree:create`:

### A. Repos with `bun run worktree:*` (`template`, `kingdom`, `tribe`)

These repos run Postgres, Redis, MinIO, and multiple apps with per-slot isolation (slots 1–9). **Always use the repo scripts — never raw `git worktree add/remove/move/prune`** (denied by hooks):

| Command | Use |
|---|---|
| `bun run worktree:create <base> <new-branch> [--skip-db]` | Provision a new isolated worktree with its own slot ports, Postgres local+test DBs, MinIO buckets, Redis DB, `bun install`, generated Prisma/routes/SDK artifacts, and schema push. Pass `--skip-db` only for docs/skills edits that need no DB or tests. |
| `bun run worktree:create <existing-branch> [--skip-db]` | Attach an existing local or remote branch (e.g. reviewing a PR). |
| `bun run worktree:list` | List all active worktrees, slots, branches, and ports. |
| `bun run worktree:ports [<name>]` | Re-apply `@inixiative/config` registry ports to a checkout's env files. |
| `bun run worktree:destroy <name> [--force]` | Drop the slot's Postgres DBs, MinIO buckets, Redis DB, kill slot listeners, remove the git worktree, and free the slot. |

Why scripts instead of bare `git worktree`: bare `git worktree add` leaves no `node_modules` or generated artifacts, causing Bun to resolve up to `main`'s workspace links and collide on `main`'s DB/ports.

### B. Libraries and standalone repos without `worktree:create` (`config`, `foundry`, `oracle`, primitives)

Use standard git worktrees placed under `.worktrees/<name>` off `origin/main`:

```bash
git fetch origin main
git worktree add .worktrees/<name> -b <type>/<name> origin/main
cd .worktrees/<name> && bun install --frozen-lockfile
```

When merged and clean:

```bash
git worktree remove .worktrees/<name>
git branch -d <type>/<name>
```

Never touch a shared `main` checkout that runs a live daemon (e.g. `foundry` serves `:4500` from its main checkout).

## 2. Subagents and working-directory resets

- **Subagents do not inherit your `cwd`** — they start at the main repo root. Always pass the exact absolute worktree path in the prompt: `Work entirely in <abs-path-to-worktree>. Do NOT touch the main repo path.`
- **Shell tools often reset `cwd` between calls.** Prefix commands with `cd <abs-worktree> && ...` or `git -C <abs-worktree> ...`.
- After a subagent finishes, check `git status` in both the worktree and the main checkout to verify nothing leaked into `main`.

## 3. Clean up after merge

- Confirm the branch is merged (for squash merges, verify via `git merge-tree --write-tree origin/main <branch>` or the merged PR's `headRefOid` — `git cherry` lies after squash merges).
- Destroy the worktree and delete the local branch so slots and disk stay free. Leave other sessions' unmerged worktrees alone.
- **Never run `git stash`** to switch or test — use a separate worktree or `git show HEAD:<path>` instead.
