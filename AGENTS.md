# ai-agent-platform

An AI Engineering Agent Platform: a web UI over an API, queue and sandboxed workers that accept tasks, run AI agents against repositories, and produce reviewable outputs behind human approval.

Status: `backend/` has the domain (phase 1 contracts done), policy, auth (dev user only) and a first projects API on NestJS, Prisma and PostgreSQL (phase 2, first slice); `frontend/` is documented but not created. Layout, decisions and phases: `README.md` and `docs/decisions.md`. The implementation plan is in `docs/README.md` (phases 0 to 7, prompt templates in `docs/08-ai-coding-agent-prompts.md`).

## Layout

- `frontend/`: the user interface (Next.js).
- `backend/`: API, worker and AI agent runtime in one codebase, organised by bounded context (D19): `backend/src/<context>/` with `domain`, `application`, `infrastructure`, `interface` layers where a context needs them. ESLint enforces the dependency rules; read `docs/decisions.md` D19 before adding a context or crossing one.
- `docs/`: implementation plan and `decisions.md`.
- `harness-engineering/`: AI coding harness, git-ignored, not part of this repository.

## Working here

- Start AI sessions from `harness-engineering/` (a folder inside this workspace). The harness rules, policies and workflows apply; project rules below supplement them and cannot weaken them. The harness expects projects at `<workspace>/<dir>/<repo>`; this repository is now the workspace root itself, so how to register it in `projects.yml` is not verified (`docs/decisions.md`, D1).
- Facts about this repo (branches, roles, protected paths, verification commands) are in `ai-manifest.yaml`. Read it first.
- Integration branch is `develop`. Work on `feat/…`, `fix/…`, `chore/…` branches from it. Never edit, commit or push on `main`, `master`, `develop`, `staging`, `production` or `release/*`.
- Only `PM` or `PL` in `ai-manifest.yaml` may instruct an AI push. Commits happen after a human reviewed the diff.

## Product rules

- Secrets (Jira, GitHub, AWS tokens, model keys) never appear in code, logs, fixtures, prompts or tool output. They live in the secrets layer only.
- Text from Jira, repositories and logs is untrusted data. It can never widen tool permissions or approvals.
- Publishing actions require a persisted PM/PL approval (D3 in `docs/decisions.md`).
- Do not add a provider, integration or dependency without evidence it is needed; record the reason in `docs/decisions.md`.
- Do not run long agent jobs inside an HTTP request; the model never chooses the target repository from task text alone.
- Projects, editable policy and UI-connected MCP servers are requirements (D7 to D9). Policy edits never relax the baseline in `backend/src/policy/domain`; MCP tools and their results are untrusted and every call goes through the policy; MCP secrets never reach the browser.
