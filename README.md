# ai-agent-platform

An AI Engineering Agent Platform: a web UI over an API, a queue and sandboxed workers. It accepts tasks, runs AI agents against repositories and returns reviewable outputs behind human approval.

Decisions and status: [docs/decisions.md](docs/decisions.md). Implementation plan: [docs/README.md](docs/README.md). Working rules for AI sessions: [AGENTS.md](AGENTS.md).

## Layout

```text
frontend/        user interface (Next.js)                        not created yet
backend/         API, worker and AI agent runtime in one codebase
  src/shared-kernel/  ids, roles, branch rules shared by every context
  src/projects/       project aggregate, use cases, storage, HTTP   (domain / application / infrastructure / interface)
  src/execution/      tasks, runs, state machine, approval rules
  src/integrations/   provider descriptors, input snapshots, repository resolution
  src/policy/         allow / ask / deny decisions for agent actions
  src/identity/       who is calling (dev user only for now)
  src/config/, src/app/   environment and composition root
  prisma/             schema and migrations (PostgreSQL)
  test/               tests, mirroring src/
docs/            implementation plan and decisions
```

`backend/src/` is organised by bounded context (D19) and grows by context as phases land (`mcp`, `worker`, `agent`, …). Dependencies point inwards and only along the allowed list; `pnpm lint` enforces them. The AI runtime is a context of the backend, not a separate service, unless decision O4 chooses otherwise.

## Commands

```bash
pnpm install
pnpm test        # backend: prisma generate + vitest
pnpm lint        # backend: eslint
pnpm typecheck   # backend: prisma generate + tsc --noEmit
```

Requires Node 22 or later and pnpm. Running the API needs PostgreSQL: see "Local setup" in [backend/README.md](backend/README.md).

## Git

Integration branch is `develop`; work on `feat/…`, `fix/…`, `chore/…`. Remote `origin` is `https://github.com/vanthan04/ai-agent-platform.git`.