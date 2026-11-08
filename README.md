# @inixiative/config

> One of the [inixiative](https://www.inixiative.com) building blocks. Stop rediscovering what you need to build. See [all the projects](https://github.com/inixiative).

The shared toolchain and theme for the inixiative packages: tsconfig, Biome and tsup presets, the brand theme CSS, a version manifest (BOM), and a CLI. One `@inixiative/config` version names one set of `@inixiative/*` versions released and checked together. `check` fails CI when a repo drifts from that set (toolchain pins, ranges, a lockfile that resolves to another version), `sync` fixes the drift, and `train` publishes the packages in dependency order.

## Presets

| Export | Use |
| --- | --- |
| `@inixiative/config/theme/public.css` | the brand: base, `--app-*` slots, status (`--success` / `--warning` / `--error`), UI (incl. `--shadow`) and type tokens, plus `@font-face` for Bricolage Grotesque, Instrument Sans and JetBrains Mono |
| `@inixiative/config/theme/status.css` | the thread/work status layer (`--status-problem / attention / working / queued / done / idle / archived`) and the badge layer, for apps that show agent work |
| `@inixiative/config/theme/domains.css` | four palettes on one structure, set with `data-domain="agentic \| building-blocks \| governance \| inixiative"` on any element; they nest |
| `@inixiative/config/theme/marketing.css` | the marketing grammar: fluid type scale, spacing and section rhythm, container and gutter, radius, elevation and motion tokens (zeroed under `prefers-reduced-motion`), and the shared classes inside `.marketing` (`eyebrow` + `status-dot`, `button` / `button-secondary` / `text-link`, `nav`, `brand`, `section`, `card`, `card-grid`, `footer`, `prose`, all in `@layer components` so Tailwind utilities and unlayered page CSS override them) |
| `@inixiative/config/theme/fonts/*` | the latin variable fonts `public.css` loads (SIL OFL 1.1, texts in `theme/fonts/LICENSES.md`) |

Apps load `public.css`, then `status.css`, then their own CSS. Marketing pages load `public.css`, `domains.css`, then `marketing.css` (after template's `theme.css` where an app has it: `[data-domain]` ties `:root`/`.dark` on specificity, so load order decides), and put `class="marketing" data-domain="…"` on the page root. Light is `:root`; dark is the `.dark` class on `<html>`. Values are HSL channels: `hsl(var(--app-primary))`, `hsl(var(--border) / .5)`. The fonts load from `./fonts/` relative to `public.css`, so serve the folder as it ships. `demo/marketing.html` (not shipped) shows every domain, the type scale, buttons, sections and long-form prose; open it from a checkout.

### Domain palettes

Each palette fills the same four slots; marketing CSS reads the slots directly (`--app-primary`), because template's `--primary` is resolved once on `:root` and does not follow a nested `data-domain`. The primary is the page's one accent (CTA, eyebrow, wordmark stop). Tertiary and quaternary appear only where they mean something (agentic: blue = shared, pink = Signet). `inixiative` is neutral ink; its secondary, tertiary and quaternary are the agentic, building-blocks and governance primaries, so each door on the hub can wear its domain. Long-form reading (`.prose`) is set for the light theme.

Contrast as text on the background (light `#f6f7f2`, dark ink `#0b1014`); the test holds every accent at 4.5:1 or more on the background and the card, and each accent's foreground on the accent.

| Domain | Slot | Light | on `#f6f7f2` | Dark | on ink |
| --- | --- | --- | --- | --- | --- |
| agentic | primary | `#466713` | 6.08 | `#c8f77e` | 15.53 |
| agentic | tertiary (shared) | `#1e69b8` | 5.18 | `#94c8ff` | 10.89 |
| agentic | quaternary (Signet) | `#a33e84` | 5.45 | `#f1b7e2` | 11.48 |
| building-blocks | primary (amber) | `#955104` | 5.64 | `#faba4c` | 11.10 |
| building-blocks | tertiary (teal) | `#0c6d6e` | 5.69 | `#51d6cd` | 10.79 |
| building-blocks | quaternary (brick) | `#ae3f29` | 5.51 | `#f9a18b` | 9.56 |
| governance | primary (violet) | `#613bba` | 6.86 | `#c0a7fb` | 9.25 |
| governance | tertiary (jade) | `#12684e` | 6.26 | `#66d6ad` | 10.73 |
| governance | quaternary (rose) | `#a92d42` | 6.21 | `#fba7b8` | 10.31 |
| inixiative | primary (ink) | `#0d1317` | 17.37 | `#eff2ed` | 16.93 |

Apps load the theme from this package at runtime, so it is a runtime `dependency` of theirs. To keep that cheap this package has no runtime dependencies and every peer is optional; a test holds both.

## versions.json (the BOM)

One version of `@inixiative/config` names one coherent state of the inixiative packages:

- `bun`: blessed runtime, written to `.bun-version` and `packageManager`
- `toolchain`: exact pins for `@biomejs/biome`, `typescript`, `tsup`, `@types/bun`
- `required`: toolchain packages every repo must carry
- `ecosystem`: the primitives lane's blessed, mutually-verified `@inixiative/*` set, plus this package
- `agentic`: the agentic lane's blessed set
- `consumers`: private repos that follow the blessed sets but never publish, keyed by GitHub `owner/repo`: `lanes` names the lanes each consumes, `upstream` the repo it syncs from
- `candidates`: published lane versions newer than their blessed one, waiting for every dependent to adopt them (see `train`); absent when there are none
- `holds`: lane packages kept below a version, keyed by package (see Holds below); absent when there are none

```jsonc
"consumers": {
  "inixiative/template": { "lanes": ["primitives"] },
  "inixiative/kingdom": { "lanes": ["primitives", "agentic"], "upstream": "inixiative/template" },
  "inixiative/oracle": { "lanes": ["agentic"] }
}
```

A lane is a release cascade with its own blessed set. `primitives` (json-rules, permissions, transitions, rules-builder, prisma-map, atlas, gloss) ships first; `agentic` (signet → archive, signet → kcp, agent-session → foundry-core → foundry → foundry-acp) builds on the primitives' blessed set and never the reverse. `check` holds every repo to the union of all lanes, so a repo that mixes both answers to both.

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
bunx @inixiative/config terms [dir] [--write-baseline]
```

`ports` prints each project's local ports from `ports.json` (also exported as `@inixiative/config/ports.json`). A project's port for a service is the service's usual default plus 100 times the project's block, so no two projects collide. Zealot alone sits at block 0, the defaults (Aron, 2026-10-20: it already runs there); every other project is off the defaults: Archive (block 7) serves HTTP on 4700 with Postgres on 6132; Kingdom (block 2) has web 3200, API 8200, Postgres 5632, Redis 6579. Reserved ports (macOS AirPlay on 5000 and 7000) are never assigned. Give a new project the next free block (never 0), and a new kind of service its usual default; the tests fail on any collision.

`check` is read-only and exits non-zero on drift; run it in CI after a frozen-lockfile install. It verifies toolchain pins (declared once, at the root, pinned exactly: a workspace member declaring one is an error, and `bun.lock` must resolve each only to its pin, with no second copy), toolchain peer ranges (they must admit the pin and no older major; `sync` writes `>=<pin major>.<pin minor>.0`), `"latest"` ranges, `packageManager`/`.bun-version`, legacy `bun.lockb`, a committed (tracked, un-ignored) `bun.lock`, a gitignored `tmp/` (scratch space; `sync` adds `/tmp/*`, which keeps re-included files tracked), required scripts (`check`/`typecheck`/`lint`/`test`), lefthook (dep + `lefthook.yml` extending the shared hooks + `prepare` script; git repos only), stub `extends`, presence of this package, and for every `@inixiative/*` dependency (in the root or any workspace member, of either lane) that the declared range admits the blessed version and the lockfile resolves to it (the stale-lockfile class). A package with a candidate (one no hold covers) also accepts the candidate and anything between: a range admitting either passes, and so does a lock from the blessed version up to the candidate. A range that does not admit the blessed version is rewritten to `^<blessed>`, except an exact pin, which stays exact and moves to the blessed version. An npm alias (`"@inixiative/session-archive": "npm:@inixiative/archive@^0.2.1"`) is held to its target's blessed version and rewritten as an alias; `workspace:`, `file:` and `link:` ranges are a repo linking itself and are left alone.

`check` also runs the **retired-terms** rule (alone: `terms`), which keeps public copy from rotting back to names the project retired. It reads text people read, never code identifiers: every Markdown, MDX, HTML and Astro file a repo tracks, and each `package.json` `description`. Fixtures, changelogs (history records the rename), `node_modules`, generated Warden regions (`.foundry/regions/`; fix their source docs) and root `dist`, `build`, `coverage` and `tmp` are skipped. The rule runs in `check` and `terms` only; `scan`, `sync` and the train are about package drift and don't run it. The list lives in `src/retiredTerms.ts`, each term with the word to use instead, and comes from the workspace CLAUDE.md "Dead concepts" and the copy brief's "Retired words":

| Term | Checked in | Use instead |
| --- | --- | --- |
| Kastle, Castle (capitalised) | every doc | Kingdom, owner, integration or Signet |
| `RuntimeInstallation`, `kingdom_runtime_` | every doc | a Signet enrollment |
| `signetDemo`, `medicalQuestionStep` | every doc | nothing; demos live in template-workbench |
| `kingdom-workspace`, `foundry-lab`, `native-candidate` | every doc | the canonical repos |
| foundry-oracle | every doc | Foundry and Oracle, two products |
| "your own LLM/API keys" | every doc | your own subscriptions |
| Cartographer, Librarian, Artificer, Steward (capitalised) | READMEs, package descriptions, site pages only | say what it does; Foundry's code still has a Librarian and a Cartographer |

Left out on purpose, because a pattern would flag mostly legitimate text: "medical" (the doctor's-visit story is allowed in marketing), "Connection" and `connectionId` (WebSocket and database connections; Foundry's viewer has a live per-socket `connectionId`), "principal" (the permissions README's glossary word for any holder, job titles, the principal–agent problem), and "Cursor as a runtime" or "token savings" (a phrase can't tell a claim from a comparison).

Per repo, in `scripts/ci/retired-terms/` (the same shape as template's doc-freshness rule):

- `allow.txt` for legitimate uses: `<term>` allows it everywhere, `<path>\t<term>` in one file, or under a directory when the path ends in `/` (a retired-names table, a history doc). Stale copy never goes here.
- `baseline.txt` for uses that predate the rule, `<path>\t<term>\t<count>`: reported as one warning, not failed. A use beyond the count fails, and so does a count that dropped (lower or delete the line), so the baseline only shrinks. `terms --write-baseline` writes it when there is none, and later only to shrink it: it refuses to add a use.

`sync` applies every fix (deleting member toolchain entries and their stale member links), re-locks via `bun install` (`--force` when a second toolchain copy survives), and runs `bun update` on stale `@inixiative/*` entries in the directory that declares them. It refuses to run on a dirty working tree without `--force`. The react preset is inferred from a `react` dependency; override with `--preset`. Missing scripts are filled with defaults; existing script bodies are never touched.

`scan` runs `check` across every inixiative checkout under a root directory, for every lane or just the one `--lane` names. Targets are derived from the BOM: lane packages match by package name (the root package or any workspace member, so a monorepo such as foundry is found by the packages it publishes), and consumers match by their `origin` GitHub repo. Directory names and local layout never need declaring: scan looks at each child of the root and one level into a child without a `package.json` (a workspace folder such as `team-workspace/`). Linked git worktrees are other sessions' branches and never targets; when several clones claim one package or repo, only those with an `origin` remote count, a clone directly under the root wins over one nested in a workspace folder, and if that still leaves more than one the target is reported ambiguous rather than guessed. Origin is the truth, not the checkout: scan fetches per repo and fails on checkouts behind origin (their findings describe a stale tree), fails when a BOM entry has no checkout at all, warns when a checkout sits on a non-default branch (its findings describe the branch, not what ships), and lists unmerged `claude/*` session branches.

`train` is the release cascade, run from a git checkout of this repo; it refuses to train from a copy that isn't one (a bunx or npm cache). One train at a time per machine: it takes one machine-wide lock, `~/.inixiative/train.lock`, shared by every clone, worktree and lane, and refuses to start while another train holds it, naming the holder and the lock path. The lock is created atomically and records the holder's pid, hostname and process start time. A lock is stale, and taken over, when its process is gone, its pid now belongs to a different process, or the file can't be parsed. A lock from another host is never judged stale; if its train is gone, delete the file. The lock is released on exit and on SIGINT, SIGTERM or SIGHUP. `--dry-run` takes no lock. It walks every lane in order (primitives, then agentic), or only the lane `--lane` names. Origin is the truth: it refuses to run from a config checkout behind origin, and it fast-forwards clean checkouts to origin before working (dirty or diverged repos still skip). It only ships the default branch: a checkout on a feature branch is skipped whole: never re-locked, committed to, or published from.

Lanes stand alone. A lane with a package missing a checkout, or claimed by ambiguous checkouts, does not run; a lane whose own check (not one against candidates, below), commit or publish fails stops there: what it already published stays a candidate, and none of its candidates is blessed that run. Neither holds back the other lane. Within a lane it walks checkouts in dependency order; per checkout it: bumps `@inixiative/*` ranges to the blessed sets with their candidates in place → re-locks → runs the repo's `check` → commits only its own changes (`package.json` files + `bun.lock`) → publishes each lane package whose local version is ahead of npm, in dependency order, and waits until the registry serves it (up to 15 minutes, since npm holds new versions for processing) → records it as a candidate in the BOM.

Blessing is two-phase, so a dependent that needs work never deadlocks a release:

1. **Candidate.** A published version is recorded under `candidates`, and the config release that ends the train carries it, so `check` in any repo's CI accepts it from then on.
2. **Adopt.** A repo (lane checkout or consumer) whose check fails against the candidates it was moved onto doesn't stop the train. Its checkout is put back as it was, and the train opens `train/adopt-<pkg>-<version>` in a worktree (the repo's own `worktree:create <base> <branch>` when it declares one, so a template-based repo gets its slot's databases, released with its `worktree:destroy`; otherwise a temporary linked worktree; either way with the repo's ignored `.env*` files copied in where missing): the same bump and re-lock, then the repo's `train:adopt` script if its package.json declares one (Foundry's re-records cassettes with `bun run test:live`), and a commit. The commit holds the train's own writes (the package.json files and `bun.lock`); what `train:adopt` produced joins them only if the script passed and the repo's `check` then passes with it in place. Otherwise that output is discarded, the branch carries the re-lock alone, and the summary reports it as opened with the re-lock only, to finish by hand; the candidate stays held either way. A repo that declares no `train:adopt` gets the re-lock alone. The branch is then re-locked onto the new config release so its CI judges it against the candidates. `--push` pushes the branch; the train opens no PR. A lane checkout that adopts publishes nothing this run. A consumer that passes against candidates commits on its default branch, like any other passing repo. If the adoption's commit is refused (its hooks typecheck), the branch is deleted and the summary says to adopt by hand.
3. **Promote.** At the end of each run a candidate is blessed (moved into its lane's section) unless something holds it: its lane stopped; a repo has an adoption branch for it that is not yet on its default branch (opened this run, unmerged, or committed but never pushed); or a repo that declares it was not walked to an outcome this run (another lane's checkout, a skipped or failed one, a consumer without a checkout). A later train finds a waiting adoption branch and opens nothing new; once it merges, the repo is on the candidate and the train promotes it. A candidate every dependent already accepts is blessed in the run that published it. An adoption branch abandoned without merging holds its candidates until it is deleted; the next train that moves that repo deletes it.

The summary lists what was blessed, every candidate with what holds it, every hold with its reason, and each pending adoption branch.

**Holds.** A hold keeps a package's breaking line out of the blessed set while its dependents can't take it yet (signet 0.12 waiting on Kingdom's grants cutover), without stopping the package's own releases or anyone else's:

```jsonc
"holds": {
  "@inixiative/signet": {
    "below": "0.12.0",
    "reason": "0.12 breaks the grants contract that prod Kingdom (0.11) speaks",
    "until": "the Kingdom grants cutover", // optional
    "owner": "inixiative-bf"               // optional: who lifts it
  }
}
```

Every version at or above `below` is held; versions below it ride the train as usual, so a patch on the old line is still recorded and blessed. A held version:

- still publishes when the package's local version is ahead of npm, and is never recorded;
- is never rediscovered as a candidate when it is already on npm at the local version;
- is never applied or blessed when it is already recorded under `candidates`: no lane checkout or consumer is moved onto it, and it stays where it is;
- is never accepted by `check`, which holds the package to its blessed version and any candidate below the hold.

`scan` and the train's summary print each hold with its reason, and name a held candidate as not applied. Lifting a hold is deleting its entry: the next train records the held version found on npm at the local version (or applies the held candidate) and adopts it like any other.

A root package publishes with `npm publish`; a workspace member is packed with `bun pm pack`, which rewrites `workspace:` ranges to the versions being released, and the tarball is published with `npm publish`, so OTP prompts pass through either way. A package already on npm at its local version but neither blessed nor a candidate (published by hand, or by a train whose lane later failed) becomes a candidate on the next run, unless a hold covers that version. Likewise, an `@inixiative/config` version committed ahead of npm (a release whose publish failed) is published by the next run, even when it blesses nothing new.

Consumers run once, after every selected lane, upstreams first, against the full blessed set: a consumer of both lanes ends coherent with both whichever lane ran. They get the same bump → re-lock → `check`, never a publish, and a passing re-lock is committed on their default branch, as a lane repo's is. Only a consumer that fails against candidates gets a branch (an adoption, above).

A train never leaves a checkout dirty or off its default branch. It only works in a checkout it found clean, so a checkout that then fails is reset to HEAD (tracked and untracked files; ignored ones such as node_modules and `.env` stay) and re-installed from its lockfile. Every branch it makes is committed in a temporary worktree, removed when the train exits.

When anything was recorded or blessed it then ships this package last, so the BOM names the new state: bumps its own patch version if npm already has the current one, blesses that version in the BOM, brings the `test/fixtures` consumers onto the blessed set, runs `check`, commits, publishes. Then every checkout the train re-locked (lane packages and consumers on their default branch, adoption branches in their worktrees) is re-locked onto that new `@inixiative/config` and committed, so none is left pinning the previous release. It never pushes unless asked: pass `--push` to push every repo it committed to and each adoption branch, then delete every other `train/*` branch, local and on origin, in each repo it moved (that repo is now on the whole target, so they are superseded). It opens no PRs. Without `--push` it prints the commands. Its worktrees, and the temporary dirs that hold them, are removed however the run ends. `--dry-run` walks the same plan and prints each step it would take (range rewrites, re-locks and checks, commits, adoption branches, publishes, BOM blessings, pushes) without running any of them; it only fetches and reads git state and `npm view`.

Each command accepts only its own flags. An unknown or misplaced flag (`--dryrun`, `--push` on `sync`) is a usage error and exits 2 before anything runs.

Division of labor: this CLI owns the toolchain set, `@inixiative/*` version coherence, stubs, and lockfile format. Renovate owns everything else plus bumping `@inixiative/config` itself, and must be fenced off the toolchain packages.

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

`lib-ci.yml` pins bun from `.bun-version`, installs with `--frozen-lockfile` (kills the stale-lockfile class), runs `inixiative-config check .` (retired terms included), then the repo's own `bun run check`. A repo that doesn't use `lib-ci.yml` (template, Kingdom, Oracle, agent-session, gloss, Tribe) adopts the retired-terms rule by running `bunx inixiative-config terms .` from its own CI rules (template: a `scripts/ci/rules/retired-terms.sh` beside `doc-freshness.sh`).

## Release flow

Two lanes, each publishing in dependency order, with config last:

- **primitives:** for example json-rules → permissions → transitions → rules-builder, plus prisma-map, atlas and gloss. Consumers: template, kingdom.
- **agentic:** signet, kcp (the Kingdom CLI proxy, on signet), archive and agent-session, then foundry-core → foundry → foundry-acp (foundry depends on archive), built on the primitives' blessed set. foundry-core, foundry and foundry-acp publish from the foundry monorepo's `packages/core`, `packages/foundry` and `packages/acp`. Consumers: oracle (a private leaf), kingdom.

A release is `train` (or `train --lane=agentic` to leave the primitives alone): bump the package's version on its default branch, then run the train. `train` automates the whole walk, this package and the consumer bumps included. Downstream repos pick up toolchain changes via `sync`.
