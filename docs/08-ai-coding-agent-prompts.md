# Prompt templates cho coding agent

## A. Audit trước khi implement
```text
Audit the existing target repository and harness-engineering setup before making changes.
Do not implement features yet. Inspect structure, package manager, framework versions,
auth, database schema, API/UI conventions, tests, CI, provider adapters, skills/rules,
and verification commands. Do not read secrets or protected files.

Identify existing functionality to reuse, missing capabilities, duplication risks,
architecture decisions, exact likely files to change, and commands needed to verify the
first implementation phase. Do not create duplicate modules or skills. Make no code
changes and do not perform external side effects.
```

## B. Implement một phase
```text
Implement only Phase [N] / task [ID] from the approved plan in target repository [PATH].
Inspect relevant code first and reuse existing conventions. Do not expand scope or refactor
unrelated modules. Before editing, state a short plan and likely files to change.

Implement the smallest complete vertical slice, add/update tests, run actual lint/typecheck/
test commands, and fix failures caused by your changes. Do not claim a command passed unless
it was run. Do not read secrets/protected files. Do not push, merge, deploy, delete data, or
perform external side effects without explicit approval.

At the end report changed files, behavior, test evidence, acceptance criteria status,
limitations, and the recommended next task.
```

## C. Review phase đã hoàn thành
```text
Review Phase [N] against its acceptance criteria. Inspect the diff and tests. Focus on
authorization, validation, failure handling, idempotency, secret leakage, race conditions,
accessibility, provider capability mismatches, and architecture consistency. Do not change
code yet. Return findings ordered by severity with file/line evidence and reproducible
scenarios. Distinguish confirmed bugs from suggestions.
```

## D. Final audit
```text
Perform a final audit of the implemented platform against the approved roadmap. Verify each
acceptance criterion using actual files and test evidence. Check UI flows, backend authorization,
provider contracts, run durability, sandbox isolation, output side effects, audit records,
secret redaction, and recovery behavior. Do not invent test results. List blockers separately
from non-blocking improvements and recommend the next smallest safe action.
```
