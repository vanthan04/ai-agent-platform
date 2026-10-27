# ai-agent-platform

An AI Engineering Agent Platform: a web UI over an API, a queue and sandboxed workers. It accepts tasks, runs AI agents against repositories and returns reviewable outputs behind human approval.

Decisions and status: [docs/decisions.md](docs/decisions.md). Implementation plan: [docs/README.md](docs/README.md). Working rules for AI sessions: [AGENTS.md](AGENTS.md).

## Layout

```text
frontend/        user interface (Next.js)                        not created yet
backend/         API, worker and AI agent runtime in one codebase
  src/domain/    schemas, run state machine, approval rules
  src/policy/    allow / ask / deny decisions for agent actions
  test/          tests, mirroring src/
docs/            implementation plan and decisions
```

`backend/src/` grows by module as phases land (`api`, `worker`, `agent`, `integrations`, …). Rule: `domain` depends on nothing, `policy` depends only on `domain`, every other module may depend on both. The AI runtime is a module of the backend, not a separate service, unless decision O4 chooses otherwise.

## Commands

```bash
pnpm install
pnpm test        # backend: vitest
pnpm lint        # backend: eslint
pnpm typecheck   # backend: tsc --noEmit
```

Requires Node 22 or later and pnpm.

## Git

Integration branch is `develop`; work on `feat/…`, `fix/…`, `chore/…`. Remote `origin` is `https://github.com/vanthan04/ai-agent-platform.git`. Nothing has been committed or pushed yet.
