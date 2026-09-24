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

```jsonc
"consumers": {
  "inixiative/template": { "lanes": ["primitives"] },
  "inixiative/kingdom": { "lanes": ["primitives", "agentic"], "upstream": "inixiative/template" },
  "inixiative/oracle": { "lanes": ["agentic"] }
}
```

A lane is a release cascade with its own blessed set. `primitives` (json-rules, permissions, transitions, rules-builder, prisma-map, atlas, gloss, archive) ships first; `agentic` (agent-session → foundry-core → foundry) builds on the primitives' blessed set and never the reverse. `check` holds every repo to the union of all lanes, so a repo that mixes both answers to both.

TypeScript 6.0 notes, discovered by this repo's fixture suite:

- TS 6.0 no longer auto-includes `node_modules/@types`, so `base.json` sets `types: ["bun"]` and `@types/bun` is required.
- tsup's dts build trips TS 6.0's `baseUrl` deprecation; the tsup presets scope `ignoreDeprecations: "6.0"` to the dts build only.

## CLI

```
bunx @inixiative/config check [dir] [--preset=base|node|react]
bunx @inixiative/config sync  [dir] [--preset=...] [--force] [--no-install]
bunx @inixiative/config scan  [root] [--lane=primitives|agentic]
bunx @inixiative/config train [root] [--lane=primitives|agentic] [--push]
```

`check` is read-only and exits non-zero on drift — run it in CI after a frozen-lockfile install. It verifies toolchain pins, `"latest"` ranges, `packageManager`/`.bun-version`, legacy `bun.lockb`, a committed (tracked, un-ignored) `bun.lock`, required scripts (`check`/`typecheck`/`lint`/`test`), lefthook (dep + `lefthook.yml` extending the shared hooks + `prepare` script; git repos only), stub `extends`, presence of this package, and for every ecosystem dependency — in the root or any workspace member, of either lane — that the declared range admits the blessed version and the lockfile actually resolves to it (the stale-lockfile class). An npm alias (`"@inixiative/session-archive": "npm:@inixiative/archive@^0.2.1"`) is held to its target's blessed version and rewritten as an alias; `workspace:`, `file:` and `link:` ranges are a repo linking itself and are left alone.

`sync` applies every fix, re-locks via `bun install`, and runs `bun update` on stale ecosystem entries. It refuses to run on a dirty working tree without `--force`. The react preset is inferred from a `react` dependency; override with `--preset`. Missing scripts are filled with defaults; existing script bodies are never touched.

`scan` runs `check` across every ecosystem checkout under a root directory, for every lane or just the one `--lane` names. Targets are derived from the BOM: lane packages match by package name — the root package or any workspace member, so a monorepo such as foundry is found by the packages it publishes — and consumers match by their `origin` GitHub repo. Directory names and local layout never need declaring: scan looks at each child of the root and one level into a child without a `package.json` (a workspace folder such as `kingdom-workspace/`). Linked git worktrees are other sessions' branches and never targets; when several clones claim one package or repo, only those with an `origin` remote count, and if that still leaves more than one the target is reported ambiguous rather than guessed. Origin is the truth, not the checkout: scan fetches per repo and fails on checkouts behind origin (their findings describe a stale tree), fails when a BOM entry has no checkout at all, warns when a checkout sits on a non-default branch (its findings describe the branch, not what ships), and surfaces unmerged `claude/*` session branches.

`train` is the release cascade, run from this repo's checkout. It walks every lane in order (primitives, then agentic), or only the lane `--lane` names. Origin is the truth: it refuses to run from a config checkout behind origin, and it fast-forwards clean checkouts to origin before working (dirty or diverged repos still skip). It only ships the default branch: a checkout on a feature branch is skipped whole — never re-locked, committed to, or published from.

Lanes stand alone. A lane with a package missing a checkout, or claimed by ambiguous checkouts, does not run; a lane whose check, commit or publish fails stops there and leaves its BOM entries as they were. Neither holds back the other lane. Within a lane it walks checkouts in dependency order; per checkout it: bumps ecosystem ranges to the blessed sets → re-locks → runs the repo's `check` → commits only its own changes (`package.json` files + `bun.lock`) → publishes each lane package whose local version is ahead of npm, in dependency order, and waits until the registry serves it → records it in its lane's section of the BOM. A root package publishes with `npm publish`; a workspace member is packed with `bun pm pack`, which rewrites `workspace:` ranges to the versions being released, and the tarball is published with `npm publish`, so OTP prompts pass through either way. A package already on npm at its local version but not yet blessed — published by hand, or by a train whose lane later failed — is blessed on the next run.

Consumers run once, after every selected lane, upstreams first, against the full blessed set: a consumer of both lanes ends coherent with both whichever lane ran. They get the same bump → re-lock → `check`, never a publish, and their changes go through review: the train commits them on a `train/ecosystem-sync-<date>` branch and leaves the checkout there until it is merged.

When anything was blessed it then ships this package last, so the BOM names the new state: bumps its own patch version if npm already has the current one, blesses that version in the BOM, brings the `test/fixtures` consumers onto the blessed set, runs `check`, commits, publishes. It never pushes unless asked: pass `--push` to push every repo it committed to and open a PR for each consumer branch; otherwise it prints the commands.

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

- **primitives** — for example json-rules → permissions → transitions → rules-builder, plus prisma-map, atlas, gloss and archive (a standalone MIT package). Consumers: template, kingdom.
- **agentic** — agent-session → foundry-core → foundry, built on the primitives' blessed set. foundry-core and foundry publish from the foundry monorepo's `packages/core` and `packages/foundry`. Consumers: oracle (a private leaf), kingdom.

A release is `train` (or `train --lane=agentic` to leave the primitives alone): bump the package's version on its default branch, then run the train. `train` automates the whole walk, this package and the consumer PRs included. Downstream repos pick up toolchain changes via `sync`.
