# Koncesii — agent working conventions

This file is the source of truth for repo conventions. Both Codex agents (which read it natively from cwd) and Claude agents (which load it via the sibling `CLAUDE.md` import) consume the same content.

For project background, architecture, and scope, read the design docs in [docs/](docs/). For day-to-day commands and the intended layout, see [README.md](README.md).

## Repository model

Single repo, trunk-based:

```
B353N/koncesii   ← origin; `main` is the only long-lived branch
```

No `develop`, no `staging`. Maintainers with write access work on short-lived feature branches off `main`; external contributors fork and open PRs from their fork (see [CONTRIBUTING.md](CONTRIBUTING.md)). Either way, work merges back into `main` via PR.

## Branching

- One branch per logical change. Name pattern: `<type>/<slug>` — e.g. `feat/dam-map`, `fix/payment-parse-eur`, `docs/red-flags-methodology`. `<type>` matches the commit types below; the slug is a short kebab-case description.
- Branch off the latest `main`. Keep branches short-lived; pull `main` in if one lingers.
- Local git worktrees are fine for juggling parallel work — just never run two unrelated changes on one branch.

## Commits

- Use [conventional commits](https://www.conventionalcommits.org): `<type>(<scope>): <subject>`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`. Scopes follow the workspace: `web`, `etl`, `db`, `ingest`, `shared`, `harvest`, `docs`.
- Subject is lowercase imperative, no trailing period.
- Use the `/smart-commit` and `/suggest-commit` skills when drafting messages. They produce the canonical format for this repo.
- **Never include `Co-Authored-By:` trailers.** Keep the history clean; CI may grep for this.
- Small, focused commits are encouraged. Commit as you go — not all at the end. Easier to review and revert. Don't mix unrelated changes in one commit.

## Pull requests

- Feature branch → PR into `main` → review → merge → delete the branch.
- Push the branch _before_ opening the PR. Keep each PR scoped to one logical change so it stays reviewable.
- Use the `gh` CLI for PR operations. Only push or open a PR when asked.

## Working directory and environment

- The runtime cwd is the project root — `/workspaces/koncesii` inside the devcontainer.
- Koncesii is a pnpm + turbo monorepo. Production runs on our own server via Coolify ([ADR-0005](docs/adr/0005-selfhosted-coolify.md)): `apps/web` is a Node SSR container reading a single SQLite database produced by the ingest pipeline; merging to `main` deploys automatically. Use the existing `pnpm` and `turbo` scripts — see [README.md](README.md).
- The monorepo scaffold (`apps/`, `packages/`, workspace + lockfile) is still being established. If a script doesn't exist yet, say so rather than inventing one.
- One-off bulk harvesters (Python) live in `tools/harvest/` and run **on a maintainer's machine**, from a Bulgarian IP — the registries block datacenter IPs. Never assume CI or the production server can reach `nkr.government.bg` or `data.egov.bg` directly.
- Run only the minimal tests needed to gain confidence in the change. Full release verification is reserved for explicit asks (release tickets, smoke tests).

## Data domain rules (project-specific)

- **ЕИК is the join key.** Concessionaires key by ЕИК (9 or 13 digits) when valid, by normalized name otherwise — ЕИК is the stable national company identifier, so joins against external datasets stay trivial.
- **Never invent or "fix" registry values.** The source registries contain contradictions (BGN vs EUR duplicates, "Няма въведени данни", 2 300,81 лв. next to 4 500 лв. free text). Contradictions are _recorded and flagged_, not silently resolved. Every parsed value carries a `*_flag` column recording its quality.
- **Red flags are computed, deterministic, and publicly documented** in [docs/red-flags.md](docs/red-flags.md). A flag is a reproducible arithmetic fact ("annual payment is 0.6% of asset value over a 35-year term"), never an accusation. Copy that implies wrongdoing is a defect — file it as a bug.
- **Every displayed number must be traceable to a source URL** (НКР партида, data.egov.bg ресурс, документ). If provenance is lost in a transformation, the transformation is wrong.
- Monetary amounts are stored in **both original form and normalized EUR** (`amount_eur`), with the BGN→EUR fixed rate 1.95583 for pre-euro values; the conversion date and rule live in `docs/core-scope.md`.

## Things not to do

- Do not commit secrets or `.env*` files. Scraped raw HTML dumps and harvested datasets do **not** belong in git either — they go to the server's snapshot storage (see `docs/etl.md`).
- Do not amend commits that have already been pushed.
- Do not force-push to a branch someone else might be reading.
- Do not delete branches you didn't create.
- Do not edit files outside your change's intended scope. If you find an unrelated bug, note it separately; don't sneak the fix into your branch.
- Do not hammer the source registries: 1 request/second, honest User-Agent, resumable jobs. We are guests on government infrastructure.

## Notes and decisions

- Design decisions, plans, and the evolving specification live in [docs/](docs/) — not as scattered notes in the repo.
- Claude agents persist cross-session facts via their file-based memory; keep anything that belongs to the project itself (decisions, scope, constraints) in `docs/` so every agent and contributor sees it.
