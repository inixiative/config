# @inixiative/config

> One of the [inixiative](https://www.inixiative.com) building blocks. Stop rediscovering what you need to build. See [all the projects](https://github.com/inixiative).

The shared toolchain and theme for the inixiative packages: tsconfig, Biome and tsup presets, the brand theme CSS, a version manifest (BOM), and a CLI. One `@inixiative/config` version names one set of `@inixiative/*` versions released and checked together. `check` fails CI when a repo drifts from that set (toolchain pins, ranges, a lockfile that resolves to another version), `sync` fixes the drift, and `train` publishes the packages in dependency order.

## Presets

| Export | Use |
| --- | --- |
| `@inixiative/config/tsconfig/base.json` | the shared compiler options (ESNext, bundler resolution, `strict`, `noEmit`, `verbatimModuleSyntax`, `types: ["bun"]`); `check` holds a repo's `tsconfig.json` to extending a `tsconfig/` preset |
| `@inixiative/config/tsconfig/node.json`, `tsconfig/react.json` | base plus `types: ["node"]` (picked only with `--preset=node`), or base plus the DOM libs and `jsx: react-jsx` (picked when the repo depends on `react`) |
| `@inixiative/config/biome/base.json`, `biome/react.json` | the Biome formatter (2 spaces, width 100, single quotes, trailing commas, semicolons) and lint rules; react adds `useExhaustiveDependencies` as a warning. `check` holds `biome.json` to extending base (and react for a react repo) |
| `@inixiative/config/lefthook/base.yml` | the shared pre-commit hooks (typecheck, Biome on staged TS files) that a repo's `lefthook.yml` extends |
| `@inixiative/config/tsup` | `node(options)` and `react(options)` tsup presets (`src/index.ts` to CJS + ESM with dts and sourcemaps; react externalises `react`, `react-dom` and `react/jsx-runtime`); options override the base, and `dts: true` keeps the TS 6.0 fix below |
| `@inixiative/config/versions.json`, `ports.json` | the BOM and the local port registry, both below |
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
- `toolchain`: exact pins for `@biomejs/biome`, `typescript`, `tsup`, `@types/bun`, `lefthook`
- `required`: toolchain packages every repo must carry (biome, typescript, `@types/bun`; lefthook is required through the lefthook check instead)
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
bunx @inixiative/config train [root] [--lane=primitives|agentic] [--push] [--dry-run] [--adopt-check-timeout=<seconds>]
bunx @inixiative/config ports [project]
bunx @inixiative/config terms [dir] [--write-baseline]
bunx @inixiative/config regions [dir]
```

`train` is the one command not run through `bunx`: run it from a git checkout of this repo (`bun src/cli.ts train …` there), because it refuses to train from a bunx or npm copy (see train).

### ports

`ports` prints each project's local ports from `ports.json` (also exported as `@inixiative/config/ports.json`). A project's port for a service is the service's usual default plus 100 times the project's block, so no two projects collide. Zealot alone sits at block 0, the defaults (Aron, 2026-10-20: it already runs there); every other project is off the defaults: template is block 1, kingdom 2, monorepo 3, foundry 5, oracle 6 and archive 7 (block 4 is free). Archive serves HTTP on 4700 with Postgres on 6132; Kingdom has web 3200, API 8200, Postgres 5632, Redis 6579. Reserved ports (macOS AirPlay on 5000 and 7000) are never assigned. Give a new project the next free block (never 0), and a new kind of service its usual default; the tests fail on any collision.

### check

`check` is read-only and exits non-zero on drift; run it in CI after a frozen-lockfile install. It verifies toolchain pins (declared once, at the root, pinned exactly: a workspace member declaring one is an error, and `bun.lock` must resolve each only to its pin, with no second copy), toolchain peer ranges (they must admit the pin and no older major; `sync` writes `>=<pin major>.<pin minor>.0`), `"latest"` ranges, `packageManager`/`.bun-version`, legacy `bun.lockb`, a committed (tracked, un-ignored) `bun.lock`, a gitignored `tmp/` (scratch space; `sync` adds `/tmp/*`, which keeps re-included files tracked), required scripts (`check`/`typecheck`/`lint`/`test`), lefthook (dep + `lefthook.yml` extending the shared hooks + `prepare` script; git repos only), stub `extends`, presence of this package, and for every `@inixiative/*` dependency (in the root or any workspace member, of either lane) that the declared range admits the blessed version and the lockfile resolves to it (the stale-lockfile class). A package with a candidate (one no hold covers) also accepts the candidate and anything between: a range admitting either passes, and so does a lock from the blessed version up to the candidate. A range that does not admit the blessed version is rewritten to `^<blessed>`, except an exact pin, which stays exact and moves to the blessed version. An npm alias (`"@inixiative/session-archive": "npm:@inixiative/archive@^0.2.1"`) is held to its target's blessed version and rewritten as an alias; `workspace:`, `file:` and `link:` ranges are a repo linking itself and are left alone.

**Unresolved merge conflicts.** `check` fails on every conflict block git left in a file: a line that starts with seven `<` or seven `>` followed by a space or the line's end, reported once per block as `<path>:<line of the opening marker>`. A line of seven `=` (or the diff3 base marker, seven `|`) belongs to the block it sits in and is never a finding alone, since it is also a Markdown heading underline. Why: on 2026-11-16 a merge of main into a Kingdom branch committed markers into 15 docs, and the repo's full check passed because nothing read docs for them. It reads every text file the repo tracks or has untracked and not ignored, code, JSON, YAML, Prisma schemas, lockfiles, fixtures and changelogs included; only `node_modules`, root `dist`, `build`, `coverage` and `tmp`, and binary files are skipped. A marker inside a fenced code block fails too: a committed marker is a leftover wherever it is. There is no allow list or baseline. To show a marker in a doc, indent it or put it mid-line; tests build marker lines at run time.

### Retired terms

`check` also runs the **retired-terms** rule (alone: `terms`), which keeps public copy from rotting back to names the project retired. It reads text people read, never code identifiers: every Markdown, MDX, HTML and Astro file a repo tracks, each `package.json` `description`, and the files the region builder writes (below). Fixtures, changelogs (history records the rename), `node_modules` and root `dist`, `build`, `coverage` and `tmp` are skipped. The rule runs in `check` and `terms` only; `scan`, `sync` and the train are about package drift and don't run it. The list lives in `src/retiredTerms.ts`, each term with the word to use instead, and comes from the workspace CLAUDE.md "Dead concepts", the copy brief's "Retired words" and the breaking sections of package changelogs:

| Term | Checked in | Use instead |
| --- | --- | --- |
| Kastle, Castle (capitalised) | every doc, regions | Kingdom, owner, integration or Signet |
| `RuntimeInstallation`, `kingdom_runtime_` | every doc, regions | a Signet enrollment |
| `signetDemo`, `medicalQuestionStep` | every doc, regions | nothing; demos live in template-workbench |
| `kingdom-workspace`, `foundry-lab`, `native-candidate` | every doc, regions | the canonical repos |
| foundry-oracle | every doc | Foundry and Oracle, two products |
| "your own LLM/API keys" | every doc | your own subscriptions |
| Cartographer, Librarian, Artificer, Steward (capitalised) | READMEs, package descriptions, site pages only | say what it does; Foundry's code still has a Librarian and a Cartographer |
| `threadsTerms`, `threadsTermsSchema`, `grantTermsSchema`, `grantTermsFitKind`, `narrowsThreadsTerms`, `meetThreadsTerms`, Kingdom's `termsNarrow`, and the `thread*Schema` term schemas (signet 0.18.0) | every doc, regions | conversation permissions picked on the grant: `member.log`, `member.wake`, `member.take`, `member.agent`, `agent.instruct`, `agent.read`, `agent.act` |
| `threadsResourceKind`, "`threads` resource" (signet 0.18.0) | every doc, regions | a `conversation` integration resource per shared thread (`conversationResourceKind`, its `externalId` the thread id) |
| `floor.mayTake` / `mayTake` (signet 0.18.0) | every doc, regions | the `member.take` permission |
| `grantReach` (Foundry's reach check before signet 0.18.0) | every doc, regions | the grant row on the thread's `conversation` resource |

Left out on purpose, because a pattern would flag mostly legitimate text: "medical" (the doctor's-visit story is allowed in marketing), "Connection" and `connectionId` (WebSocket and database connections; Foundry's viewer has a live per-socket `connectionId`), "principal" (the permissions README's glossary word for any holder, job titles, the principal–agent problem), and "Cursor as a runtime" or "token savings" (a phrase can't tell a claim from a comparison).

**Regions.** A Warden region copies its docs, so a name retired in the docs lives on in the region until someone rebuilds it, and the region records nothing that says it is out of date. signet 0.18.0 showed this: the docs moved to conversation resources and four signet regions kept describing grant terms. The generated files (in any regions directory, `.foundry/regions` or a base layer such as Kingdom's `.foundry/template/regions`: each region's `knowledge.md`, `recognise.md` and `region.json`, and the set's `GLOSSARY.md`, `registry.json`, `ECOSYSTEM.md`, `ERRORS.md`) are read for the terms marked **removed concepts** (the "regions" rows above): names of things that no longer exist, which point a Warden at nothing. Marketing words are not read there: a Warden is not public copy. A hit in a region is a **warning** from the region-freshness rule below, one per region, that says to rebuild it, never a line to edit; it never fails `check`, and it never goes in the baseline. A region's verbatim copy of an allowed doc line is allowed with it. Hand-written files beside the regions (a `README.md` in the regions directory, `.foundry/warden-brief.md`) are ordinary docs: a retired name there fails like in any doc.

Per repo, in `scripts/ci/retired-terms/` (the same shape as template's doc-freshness rule):

- `allow.txt` for legitimate uses. Every entry sits under a `#` comment that says why (one comment may head a block of entries; a blank line ends the block). Fields are separated by one tab, with no spaces around them, and paths are exact: a file, or a directory ending in `/`, never a pattern. Three forms:
  - `<term>` allows it everywhere.
  - `<path>\t<term>` allows it in one file, or under a directory: for a file that is history as a whole (a dated design record, a review, a ticket, a retired-names table; changelogs are skipped without one).
  - `<path>\t<term>\t"<snippet>"` allows one history mention in a live doc (`docs/CONVERSATIONS.md\tsignet-may-take\t"(once \`floor.mayTake\`)"`). The snippet quotes the retired name and words around it, and appears on exactly one line of that file; it allows only the use it quotes on that line, wherever the line moves. Another use of the name, on that line or any other, still fails. A snippet that is only the name, or that appears on more than one line, fails: lengthen it.

  Every entry must cover a use today: one that covers nothing fails (`this allow covers nothing: delete it`), so the list never rots. A malformed line fails with its line number and the forms above. Stale copy never goes here.
- `baseline.txt` for uses that predate the rule, `<path>\t<term>\t<count>`: reported as one warning, not failed. A use beyond the count fails, and so does a count that dropped (lower or delete the line), so the baseline only shrinks. `terms --write-baseline` writes it when there is none, and later only to shrink it: it refuses to add a use. Its `# terms:` line records the terms it was written against; uses of a term added to the list since then predate the rule in that repo, and `--write-baseline` adds them. A baseline without that line was written by the release before it, whose list was the first eight terms (Kastle through the Foundry roles): `--write-baseline` reads it so once, adds the newer terms' uses and rewrites it with the line.

### Region freshness

`check` also runs the **region-freshness** rule (alone: `regions [dir]`), which compares each Warden region with the docs it was built from. Why: a region records no commit or hash of what it was built from, so after signet 0.18.0 four signet regions and several docs still described grant terms and nothing noticed (Aron, 2026-11-15, asked for CI that catches it, in config "since they're kind of like a shared experience"). Part 4a of a region's `knowledge.md` holds the doc sections it was built from, verbatim, and `region.json` `sources.docUnits` names them (`doc:<path>#<slug>`). The rule cuts each named unit from the repo's doc as it is today, with the region builder's own rule (split at H2, an H2 over 2500 tokens at H3; empty, contents and short-preface sections dropped; "Do not copy" material stripped; headings moved down two levels), and compares it with the copy, source line included. It reads files only: no network, no model call, a few milliseconds per region.

**Every region finding is a warning, never a failure.** A check fails only on something the person whose CI is red can fix. A contributor can fix a doc line; only the machine that holds the region builder (a model stage and a work directory) can rebuild a region. So a stale copy, a gone section and a retired name inside a region each say "rebuild region <id>" and count in the summary line, which ends every run that has something to say, so they show in every `check`; none of them turns it red, and there is nothing to baseline.

Each region is one of:

- **fresh**: every unit it names was compared, and every copy matches.
- **partly checked**: the units compared match; others copy another repo's docs (a library the registry's `builtFrom.libraries` names, as `<name>/…` or `@scope/<name>/…`) and are not compared. The line gives the count: `1 of 2 doc units checked`.
- **not checked**: it copies no doc sections, or only other repos'.
- **stale**: a copied section changed (`+a −b lines` and the first new line).
- **gone**: a section it copies is gone, its file or its heading not there today (a renamed heading looks the same as a removed one).
- **unverifiable**: its `region.json` names no `sources.docUnits`, its `knowledge.md` has no part 4a (another granularity, or an older builder), or a unit it names has no copy.

and separately, a region that **names something retired** (above).

Only the layers Foundry reads count, as its `chorusLayers` reads `.foundry/project.json`: `chorus.layers` as written, else `chorus.regions`, else `.foundry/regions`. Of those, only `.foundry/regions` (where the builder installs) is compared. Any other layer (Kingdom's `.foundry/template/regions`) was built from another repo's docs and is named once as **not checked here**: nothing compares it today, here or in the repo it came from. A repo with no regions passes with nothing to say. A copy made by a builder that did not yet strip "Do not copy" material also compares, against the doc as written.

What is read and what isn't (the summary line says so too): only part 4a is compared with the docs. The rest of each region (the model-written parts 1–3, part 4b's code entries, `recognise.md`, `region.json`) and the set's `GLOSSARY.md` and `registry.json` are only scanned for retired names, never compared. Doc sections no region copies (a new section that belongs in a region) are not seen. A region can also be wrong although its docs did not change: a member in the wrong region, or a code entry whose code moved. Nothing in this rule throws: a regions directory that is a file, an unreadable directory, region or doc, or an unreadable `.foundry/project.json` is one warning that names the path and what happened.

**The port.** `src/docUnits.ts` ports the builder's `units.py` (`doc_units`, `sections`, `strip_do_not_copy`, `slug`) and `assemble.py` (`demote`, the part-4 layout); the builder lives outside the repos (`~/.foundry/evals/setup-practice/pipeline/`). `test/fixtures/doc-units-parity/expected.json` is the builder's own cut of the docs beside it, including docs at each boundary the cut has (the H3 split at 2500 tokens, the 40-token preface, "table of contents", indented and `~~~` fences, code-point length, every character of Python's whitespace, Unicode digits and word boundaries, U+2028 in a heading), with assemble.py's `demote`, source lines and part 4a for them, and `test/docUnits.test.ts` checks the port reproduces all of it. When the builder changes, regenerate it from the builder directory and run the tests:

```
python3 -I scripts/doc-units-parity/regenerate.py [~/.foundry/evals/setup-practice/pipeline]
```

The port goes away once the builder records, in `region.json`, the `sourceCommit` it read the repo at and a hash per doc unit (and per code entry): the check then compares hashes and stops depending on the builder's cut and the part-4 layout.

### Adopting a release that adds retired terms

New terms fail only in a repo's own docs, so adopting one is the path config #15 took when it added the first eight. Then, foundry (#302) and archive (#55) landed their `allow.txt` and `baseline.txt` before the release, which the old config never read, and the train's dependency sync moved them onto it. This time the order matters for the baseline: the installed (old) config does read `baseline.txt`, and a line for a term it doesn't know counts as a use that went away (`no longer uses … → delete its line`). So:

1. Allow lines (all three forms) can land first: the old config reads only `<path>\t<term>`, and a term id it doesn't know allows nothing.
2. After this release is published, the config bump and the baseline land in **one commit**: `bun update @inixiative/config`, then `bunx inixiative-config terms --write-baseline .` (with the bump installed, `bunx` runs the new version from `node_modules`; run before the bump, it runs the old one), then commit `package.json`, `bun.lock` and `scripts/ci/retired-terms/` together.

A baseline written by the release before the `# terms:` line is upgraded by that same `--write-baseline`.

**The signet 0.18.0 names** describe what signet removed in 0.18.0, so a repo whose code is still on signet 0.17 or earlier (Foundry and Kingdom main, today) describes its own code correctly with them. Such a repo adopts these names when it adopts signet 0.18: until then its baseline covers them, and its 0.18 migration rewrites the docs and shrinks the baseline. There is no version scoping. For the same reason this config release ships **after** Foundry #370 and Kingdom #261 (their signet 0.18 adoptions) merge.

### sync

`sync` applies every fix (deleting member toolchain entries and their stale member links), re-locks via `bun install` (`--force` when a second toolchain copy survives), and runs `bun update` on stale `@inixiative/*` entries in the directory that declares them. It refuses to run on a dirty working tree without `--force`. The react preset is inferred from a `react` dependency; override with `--preset`. Missing scripts are filled with defaults; existing script bodies are never touched.

### scan

`scan` runs `check` across every inixiative checkout under a root directory, for every lane or just the one `--lane` names. Targets are derived from the BOM: lane packages match by package name (the root package or any workspace member, so a monorepo such as foundry is found by the packages it publishes), and consumers match by their `origin` GitHub repo. Directory names and local layout never need declaring: scan looks at each child of the root and one level into a child without a `package.json` (a workspace folder such as `team-workspace/`). Linked git worktrees are other sessions' branches and never targets; when several clones claim one package or repo, only those with an `origin` remote count, a clone directly under the root wins over one nested in a workspace folder, and if that still leaves more than one the target is reported ambiguous rather than guessed. Origin is the truth, not the checkout: scan fetches per repo and fails on checkouts behind origin (their findings describe a stale tree), fails when a BOM entry has no checkout at all, warns when a checkout sits on a non-default branch (its findings describe the branch, not what ships), and lists unmerged `claude/*` session branches.

### train

`train` is the release cascade, run from a git checkout of this repo; it refuses to train from a copy that isn't one (a bunx or npm cache). One train at a time per machine: it takes one machine-wide lock, `~/.inixiative/train.lock`, shared by every clone, worktree and lane, and refuses to start while another train holds it, naming the holder and the lock path. The lock is created atomically and records the holder's pid, hostname and process start time. A lock is stale, and taken over, when its process is gone, its pid now belongs to a different process, or the file can't be parsed. A lock from another host is never judged stale; if its train is gone, delete the file. The lock is released on exit and on SIGINT, SIGTERM or SIGHUP. `--dry-run` takes no lock. It walks every lane in order (primitives, then agentic), or only the lane `--lane` names. Origin is the truth: it refuses to run from a config checkout behind origin, and it fast-forwards clean checkouts to origin before working (dirty or diverged repos still skip). It only ships the default branch: a checkout on a feature branch is skipped whole: never re-locked, committed to, or published from.

Lanes stand alone. A lane with a package missing a checkout, or claimed by ambiguous checkouts, does not run; a lane whose own check (not one against candidates, below), commit or publish fails stops there: what it already published stays a candidate, and none of its candidates is blessed that run. Neither holds back the other lane. Within a lane it walks checkouts in dependency order; per checkout it: bumps `@inixiative/*` ranges to the blessed sets with their candidates in place → re-locks → runs the repo's `check` → commits only its own changes (`package.json` files + `bun.lock`) → publishes each lane package whose local version is ahead of npm, in dependency order, and waits until the registry serves it (up to 15 minutes, since npm holds new versions for processing) → records it as a candidate in the BOM.

Blessing is two-phase, so a dependent that needs work never deadlocks a release:

1. **Candidate.** A published version is recorded under `candidates`, and the config release that ends the train carries it, so `check` in any repo's CI accepts it from then on.
2. **Adopt.** A repo (lane checkout or consumer) whose check fails against the candidates it was moved onto doesn't stop the train. Its checkout is put back as it was, and the train opens `train/adopt-<pkg>-<version>` in a worktree (the repo's own `worktree:create <base> <branch>` when it declares one, so a template-based repo gets its slot's databases, released with its `worktree:destroy`; otherwise a temporary linked worktree; either way with the repo's ignored `.env*` files copied in where missing): the same bump and re-lock, then the repo's `train:adopt` script if its package.json declares one (Foundry's re-records cassettes with `bun run test:live`), and a commit. The train stages its own writes (the package.json files and `bun.lock`) before `train:adopt` runs and captures what the script wrote as it exits. That output joins the commit only if the script passed and the repo's `check` then passes with it in place, within `--adopt-check-timeout` seconds (default 1800; a timeout is a failure). That check runs against the config release the train started from, before the branch is re-locked onto the new one. Anything the check itself writes is never committed. Otherwise the adoption is **incomplete**: the commit is the re-lock alone (`chore: adopt <label> (incomplete)`, with a `Train-Adopt: incomplete (<reason>)` trailer), and the script's output, edits to owned files included, is saved on `<branch>-output`, one commit on top of it, which `--push` pushes beside the branch. Later trains read the trailer, keep reporting the branch as incomplete, and print what to run to finish it: `bun run train:adopt && bun run check` on the branch, then a commit with the trailer `Train-Adopt: complete`. A repo that declares no `train:adopt` gets the re-lock alone. `--dry-run` never fails a check, so for each repo moving onto candidates it prints how an adoption would be decided. The branch is then re-locked onto the new config release so its CI judges it against the candidates. `--push` pushes the branch; the train opens no PR. A lane checkout that adopts publishes nothing this run. A consumer that passes against candidates commits on its default branch, like any other passing repo. If the adoption's commit is refused (its hooks typecheck), the branch is deleted and the summary says to adopt by hand.
3. **Promote.** At the end of each run a candidate is blessed (moved into its lane's section) unless something holds it: its lane stopped; a repo has an adoption branch for it that is not yet on its default branch (opened this run, incomplete, unmerged, or committed but never pushed); or a repo that declares it was not walked to an outcome this run (another lane's checkout, a skipped or failed one, a consumer without a checkout). A later train finds a waiting adoption branch and opens nothing new; once it merges, the repo is on the candidate and the train promotes it. A candidate every dependent already accepts is blessed in the run that published it. An adoption branch abandoned without merging holds its candidates until it is deleted; the next train that moves that repo deletes it.

The summary lists what was blessed, every candidate with what holds it (an incomplete adoption is marked so), every hold with its reason, and each pending adoption branch.

### Holds

A hold keeps a package's breaking line out of the blessed set while its dependents can't take it yet, without stopping the package's own releases or anyone else's. The BOM has no holds today; this one (signet 0.12, held until Kingdom's grants cutover) is an example from an earlier release:

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

### Publishing, consumers and the config release

A root package publishes with `npm publish`; a workspace member is packed with `bun pm pack`, which rewrites `workspace:` ranges to the versions being released, and the tarball is published with `npm publish`, so OTP prompts pass through either way. A package already on npm at its local version but neither blessed nor a candidate (published by hand, or by a train whose lane later failed) becomes a candidate on the next run, unless a hold covers that version. Likewise, an `@inixiative/config` version committed ahead of npm (a release whose publish failed) is published by the next run, even when it blesses nothing new.

Consumers run once, after every selected lane, upstreams first, against the full blessed set: a consumer of both lanes ends coherent with both whichever lane ran. They get the same bump → re-lock → `check`, never a publish, and a passing re-lock is committed on their default branch, as a lane repo's is. Only a consumer that fails against candidates gets a branch (an adoption, above).

A train never leaves a checkout dirty or off its default branch. It only works in a checkout it found clean, so a checkout that then fails is reset to HEAD (tracked and untracked files; ignored ones such as node_modules and `.env` stay) and re-installed from its lockfile. Every branch it makes is committed in a temporary worktree, removed when the train exits.

When anything was recorded or blessed it then ships this package last, so the BOM names the new state: bumps its own patch version if npm already has the current one, blesses that version in the BOM, brings the `test/fixtures` consumers onto the blessed set, runs `check`, commits, publishes. Then every checkout the train re-locked (lane packages and consumers on their default branch, adoption branches in their worktrees) is re-locked onto that new `@inixiative/config` and committed, so none is left pinning the previous release. It never pushes unless asked: pass `--push` to push every repo it committed to and each adoption branch, then delete every other `train/*` branch, local and on origin, in each repo it moved (that repo is now on the whole target, so they are superseded). It opens no PRs. Without `--push` it prints the commands. Its worktrees, and the temporary dirs that hold them, are removed however the run ends. `--dry-run` walks the same plan and prints each step it would take (range rewrites, re-locks and checks, commits, adoption branches, publishes, BOM blessings, pushes) without running any of them; it only fetches and reads git state and `npm view`.

### Flags and division of labor

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

`lib-ci.yml` pins bun from `.bun-version`, optionally restores and saves one cache (inputs `cache-path` and `cache-key`, for a fixture a suite downloads; off when `cache-path` is empty), installs with `--frozen-lockfile` (kills the stale-lockfile class), runs `inixiative-config check .` (retired terms and region freshness included), then the repo's own `bun run check`. A repo that doesn't use `lib-ci.yml` (template, Kingdom, Oracle, agent-session, gloss, Tribe) adopts both rules by running `bunx inixiative-config terms .` and `bunx inixiative-config regions .` from its own CI rules (template: scripts in `scripts/ci/rules/` beside `doc-freshness.sh`).

## Release flow

Two lanes, each publishing in dependency order, with config last:

- **primitives:** for example json-rules → permissions → transitions → rules-builder, plus prisma-map, atlas and gloss. Consumers: template, kingdom.
- **agentic:** signet, kcp (the Kingdom CLI proxy, on signet), archive and agent-session, then foundry-core → foundry → foundry-acp (foundry depends on archive), built on the primitives' blessed set. foundry-core, foundry and foundry-acp publish from the foundry monorepo's `packages/core`, `packages/foundry` and `packages/acp`. Consumers: oracle (a private leaf), kingdom.

A release is `train` (or `train --lane=agentic` to leave the primitives alone): bump the package's version on its default branch, then run the train. `train` automates the whole walk, this package and the consumer bumps included. Downstream repos pick up toolchain changes via `sync`.
