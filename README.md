# @inixiative/config

Shared toolchain for the inixiative ecosystem: tsconfig/biome/tsup presets, a version manifest (BOM), and a `sync`/`check` CLI that enforces both.

## Presets

| Export | Use |
| --- | --- |
| `@inixiative/config/tsconfig/base.json` | bun library (bundler resolution, verbatimModuleSyntax, `types: ["bun"]`) |
| `@inixiative/config/tsconfig/node.json` | base + `types: ["node"]` |
| `@inixiative/config/tsconfig/react.json` | base + DOM lib + `jsx: react-jsx` |
| `@inixiative/config/biome/base.json` | formatter + linter core (single quotes, lineWidth 100, recommended + strictness block) |
| `@inixiative/config/biome/react.json` | overlay: hook dependency linting |
| `@inixiative/config/tsup` | `node(options)` / `react(options)` build presets |
| `@inixiative/config/lefthook/base.yml` | pre-commit hooks: typecheck + biome on staged files |

Adoption is three stub files plus the devDependency:

```jsonc
// tsconfig.json
{ "extends": "@inixiative/config/tsconfig/base.json", "exclude": ["dist"] }

// biome.json
{ "extends": ["@inixiative/config/biome/base.json"] }
```

```ts
// tsup.config.ts
import { node } from '@inixiative/config/tsup';

export default node();
```

Stubs hold `extends` plus minimal reviewed overrides only. This package never generates config bodies.

## versions.json (the BOM)

One version of `@inixiative/config` names one coherent ecosystem state:

- `bun` — blessed runtime, written to `.bun-version` and `packageManager`
- `toolchain` — exact pins for `@biomejs/biome`, `typescript`, `tsup`, `@types/bun`
- `required` — toolchain packages every repo must carry
- `ecosystem` — the primitives lane's blessed, mutually-verified `@inixiative/*` set, plus this package
- `agentic` — the agentic lane's blessed set
- `consumers` — private repos that follow the blessed sets but never publish, keyed by GitHub `owner/repo`: `lanes` names the lanes each consumes, `upstream` the repo it syncs from
- `candidates` — published lane versions newer than their blessed one, waiting for every dependent to adopt them (see `train`); absent when there are none

```jsonc
"consumers": {
  "inixiative/template": { "lanes": ["primitives"] },
  "inixiative/kingdom": { "lanes": ["primitives", "agentic"], "upstream": "inixiative/template" },
  "inixiative/oracle": { "lanes": ["agentic"] }
}
```

A lane is a release cascade with its own blessed set. `primitives` (json-rules, permissions, transitions, rules-builder, prisma-map, atlas, gloss) ships first; `agentic` (signet → archive, agent-session → foundry-core → foundry → foundry-acp) builds on the primitives' blessed set and never the reverse. `check` holds every repo to the union of all lanes, so a repo that mixes both answers to both.

TypeScript 6.0 notes, discovered by this repo's fixture suite:

- TS 6.0 no longer auto-includes `node_modules/@types`, so `base.json` sets `types: ["bun"]` and `@types/bun` is required.
- tsup's dts build trips TS 6.0's `baseUrl` deprecation; the tsup presets scope `ignoreDeprecations: "6.0"` to the dts build only.

## CLI

```
bunx @inixiative/config check [dir] [--preset=base|node|react]
bunx @inixiative/config sync  [dir] [--preset=...] [--force] [--no-install]
bunx @inixiative/config scan  [root] [--lane=primitives|agentic]
bunx @inixiative/config train [root] [--lane=primitives|agentic] [--push] [--dry-run]
bunx @inixiative/config ports [project]
```

`ports` prints each project's local ports from `ports.json` (also exported as `@inixiative/config/ports.json`). A project's port for a service is the service's usual default plus 100 times the project's block, so no two projects collide and none sits on a default: Archive (block 7) serves HTTP on 4700 with Postgres on 6132; Kingdom (block 2) has web 3200, API 8200, Postgres 5632, Redis 6579. Reserved ports (macOS AirPlay on 5000 and 7000) are never assigned. Give a new project the next free block, and a new kind of service its usual default; the tests fail on any collision.

`check` is read-only and exits non-zero on drift — run it in CI after a frozen-lockfile install. It verifies toolchain pins — declared once, at the root, pinned exactly: a workspace member declaring one is an error, and `bun.lock` must resolve each only to its pin (no second copy) — toolchain peer ranges (they must admit the pin and no older major; `sync` writes `>=<pin major>.<pin minor>.0`), `"latest"` ranges, `packageManager`/`.bun-version`, legacy `bun.lockb`, a committed (tracked, un-ignored) `bun.lock`, required scripts (`check`/`typecheck`/`lint`/`test`), lefthook (dep + `lefthook.yml` extending the shared hooks + `prepare` script; git repos only), stub `extends`, presence of this package, and for every ecosystem dependency — in the root or any workspace member, of either lane — that the declared range admits the blessed version and the lockfile actually resolves to it (the stale-lockfile class). A package with a candidate also accepts the candidate and anything between: a range admitting either passes, and so does a lock from the blessed version up to the candidate. A range that does not admit the blessed version is rewritten to `^<blessed>`, except an exact pin, which stays exact and moves to the blessed version. An npm alias (`"@inixiative/session-archive": "npm:@inixiative/archive@^0.2.1"`) is held to its target's blessed version and rewritten as an alias; `workspace:`, `file:` and `link:` ranges are a repo linking itself and are left alone.

`sync` applies every fix (deleting member toolchain entries and their stale member links), re-locks via `bun install` (`--force` when a second toolchain copy survives), and runs `bun update` on stale ecosystem entries in the directory that declares them. It refuses to run on a dirty working tree without `--force`. The react preset is inferred from a `react` dependency; override with `--preset`. Missing scripts are filled with defaults; existing script bodies are never touched.

`scan` runs `check` across every ecosystem checkout under a root directory, for every lane or just the one `--lane` names. Targets are derived from the BOM: lane packages match by package name — the root package or any workspace member, so a monorepo such as foundry is found by the packages it publishes — and consumers match by their `origin` GitHub repo. Directory names and local layout never need declaring: scan looks at each child of the root and one level into a child without a `package.json` (a workspace folder such as `team-workspace/`). Linked git worktrees are other sessions' branches and never targets; when several clones claim one package or repo, only those with an `origin` remote count, a clone directly under the root wins over one nested in a workspace folder, and if that still leaves more than one the target is reported ambiguous rather than guessed. Origin is the truth, not the checkout: scan fetches per repo and fails on checkouts behind origin (their findings describe a stale tree), fails when a BOM entry has no checkout at all, warns when a checkout sits on a non-default branch (its findings describe the branch, not what ships), and surfaces unmerged `claude/*` session branches.

`train` is the release cascade, run from a git checkout of this repo; it refuses to train from a copy that isn't one (a bunx or npm cache). One train at a time per machine: it takes one machine-wide lock, `~/.inixiative/train.lock`, shared by every clone, worktree and lane, and refuses to start while another train holds it, naming the holder and the lock path. The lock is created atomically and records the holder's pid, hostname and process start time. A lock is stale, and taken over, when its process is gone, its pid now belongs to a different process, or the file can't be parsed. A lock from another host is never judged stale; if its train is truly gone, delete the file. The lock is released on exit and on SIGINT, SIGTERM or SIGHUP. `--dry-run` takes no lock. It walks every lane in order (primitives, then agentic), or only the lane `--lane` names. Origin is the truth: it refuses to run from a config checkout behind origin, and it fast-forwards clean checkouts to origin before working (dirty or diverged repos still skip). It only ships the default branch: a checkout on a feature branch is skipped whole — never re-locked, committed to, or published from.

Lanes stand alone. A lane with a package missing a checkout, or claimed by ambiguous checkouts, does not run; a lane whose own check (not one against candidates, below), commit or publish fails stops there: what it already published stays a candidate, and none of its candidates is blessed that run. Neither holds back the other lane. Within a lane it walks checkouts in dependency order; per checkout it: bumps ecosystem ranges to the blessed sets with their candidates in place → re-locks → runs the repo's `check` → commits only its own changes (`package.json` files + `bun.lock`) → publishes each lane package whose local version is ahead of npm, in dependency order, and waits until the registry serves it (up to 15 minutes, since npm holds new versions for processing) → records it as a candidate in the BOM.

Blessing is two-phase, so a dependent that needs work never deadlocks a release:

1. **Candidate.** A published version is recorded under `candidates`, and the config release that ends the train carries it, so `check` in any repo's CI accepts it from then on.
2. **Adopt.** A repo (lane checkout or consumer) whose check fails against the candidates it was moved onto doesn't stop the train. Its checkout is put back as it was, and the train opens `train/adopt-<pkg>-<version>` in a worktree (with the repo's ignored `.env*` files copied in, at any depth): the same bump and re-lock, then the repo's `train:adopt` script if its package.json declares one (Foundry's re-records cassettes with `bun run test:live`), all committed, and re-locked onto the new config release so the PR's CI judges it against the candidates. A lane checkout that adopts publishes nothing this run. A consumer that passes against candidates gets the same branch name: its default branch is still on the previous versions until the branch merges. If the adoption's commit is refused (its hooks typecheck), the branch is deleted and the summary says to adopt by hand.
3. **Promote.** At the end of each run a candidate is blessed (moved into its lane's section) unless something holds it: its lane stopped; a repo has an adoption branch for it that is not yet on its default branch (opened this run, unmerged, or committed but never pushed); or a repo that declares it was not walked to an outcome this run — another lane's checkout, a skipped or failed one, a consumer without a checkout. A later train finds a waiting adoption branch and opens nothing new; once it merges, the repo is on the candidate and the train promotes it. A candidate every dependent already accepts is blessed in the run that published it. An adoption PR closed without merging holds its candidates until its branch is deleted.

The summary lists what was blessed, every candidate with what holds it, and each pending adoption branch with its PR when `gh` can find one.

A root package publishes with `npm publish`; a workspace member is packed with `bun pm pack`, which rewrites `workspace:` ranges to the versions being released, and the tarball is published with `npm publish`, so OTP prompts pass through either way. A package already on npm at its local version but neither blessed nor a candidate — published by hand, or by a train whose lane later failed — becomes a candidate on the next run. Likewise, an `@inixiative/config` version committed ahead of npm (a release whose publish failed) is published by the next run, even when it blesses nothing new.

Consumers run once, after every selected lane, upstreams first, against the full blessed set: a consumer of both lanes ends coherent with both whichever lane ran. They get the same bump → re-lock → `check`, never a publish, and their changes go through review: the train commits them on a `train/ecosystem-sync-<date>` branch, in a worktree, and puts the checkout back on its default branch, clean.

A train never leaves a checkout dirty or off its default branch. It only works in a checkout it found clean, so a checkout that then fails is reset to HEAD (tracked and untracked files; ignored ones such as node_modules and `.env` stay) and re-installed from its lockfile. Every branch it makes is committed in a temporary worktree, removed when the train exits.

When anything was recorded or blessed it then ships this package last, so the BOM names the new state: bumps its own patch version if npm already has the current one, blesses that version in the BOM, brings the `test/fixtures` consumers onto the blessed set, runs `check`, commits, publishes. Then every checkout the train re-locked (lane packages on their default branch, consumer and adoption branches in their worktrees) is re-locked onto that new `@inixiative/config` and committed, so none is left pinning the previous release. It never pushes unless asked: pass `--push` to push every repo it committed to and open a PR for each consumer and adoption branch; otherwise it prints the commands. `--dry-run` walks the same plan and prints each step it would take (range rewrites, re-locks and checks, commits, review branches, publishes, BOM blessings, pushes) without running any of them; it only fetches and reads git state and `npm view`.

Each command accepts only its own flags. An unknown or misplaced flag (`--dryrun`, `--push` on `sync`) is a usage error and exits 2 before anything runs.

Division of labor: this CLI owns the toolchain set, ecosystem coherence, stubs, and lockfile format. Renovate owns everything else plus bumping `@inixiative/config` itself, and must be fenced off the toolchain packages.

## CI

Every lib repo gets a two-line caller workflow:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    uses: inixiative/config/.github/workflows/lib-ci.yml@main
```

`lib-ci.yml` pins bun from `.bun-version`, installs with `--frozen-lockfile` (kills the stale-lockfile class), runs `inixiative-config check .`, then the repo's own `bun run check`.

## Release flow

Two lanes, each publishing in dependency order, with config last:

- **primitives** — for example json-rules → permissions → transitions → rules-builder, plus prisma-map, atlas and gloss. Consumers: template, kingdom.
- **agentic** — archive and agent-session, then foundry-core → foundry (foundry depends on archive), built on the primitives' blessed set. foundry-core and foundry publish from the foundry monorepo's `packages/core` and `packages/foundry`. Consumers: oracle (a private leaf), kingdom.

A release is `train` (or `train --lane=agentic` to leave the primitives alone): bump the package's version on its default branch, then run the train. `train` automates the whole walk, this package and the consumer PRs included. Downstream repos pick up toolchain changes via `sync`.
