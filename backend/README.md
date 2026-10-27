# backend

API, worker and AI agent runtime in one TypeScript codebase. Code lives in `src/<module>/`, tests in `test/<module>/`.

## Modules

| Module | Status | Owns |
|---|---|---|
| `domain` | phase 1 done | zod schemas (Task, Run, Step, ToolCall, Approval, Artifact, RunEvent, ProviderDescriptor, InputSnapshot, RepositoryResolution), run state machine including `blocked` (D14), approval validation, branch protection. Tasks and runs carry a `projectId`; a run carries an idempotency key and a correlation id. Pure, depends on nothing. |
| `policy` | done (baseline) | `evaluate()`: allow, ask or deny for each agent action (file, command, push, external write). Depends only on `domain`. The baseline rules stay in code; the per-project editable part (`PolicyContext`, D8) will be loaded from storage. An MCP tool call needs a new action kind (D9). |
| `projects` | planned, phase 2 | projects added from the UI (D7), their members and roles, repositories and allowed branches; every task and run carries a `projectId`. |
| `mcp` | planned, phases 2 and 6 | MCP connections per project (D9): stored config, secret reference, discovered tools and their `allow` or `ask` decision. |
| `api` | planned, phase 2 | authentication, roles (PM, PL, DEV), project scoping, task and run endpoints, provider registry, policy editing with versions, persisted approvals, audit, event history. Accepts a request, stores a run, returns; never executes agent work. |
| `worker` | planned, phases 4 to 7 | takes queued runs, drives them through `transition()`, sandboxed checkout and commands, publishes only after a persisted PM or PL approval of the exact diff and target branch (D3). |
| `agent` | planned, phase 6 | the AI runtime: analysis, plan and report with structured schemas, read-only tools first. Every tool call goes through `policy.evaluate()`. |
| `integrations` | planned, phases 5 and 8 | provider adapters (Jira, GitHub, CodeCommit) behind one contract. |

Only create a module when its phase starts; there are no empty placeholder folders.

## Decisions that still open this layout

Framework, ORM, database and queue (O5, O6) and whether the AI runtime stays in TypeScript (O4) are in `../docs/decisions.md`. Until then no framework is installed; this package has only `zod` plus tooling.

## Commands

```bash
pnpm test
pnpm lint
pnpm typecheck
```
