# Phase 7 — Output, approval và production readiness

## Mục tiêu
Đưa output tới destination đã cấu hình, có approval, idempotency, audit và monitoring.

## Thứ tự output
1. Report artifact.
2. JSON artifact.
3. Patch/diff artifact.
4. Branch/commit/PR nếu provider hỗ trợ.
5. Jira comment hoặc issue update theo policy.

## Provider capabilities
Mỗi output provider khai báo:
- Supported operations.
- Required permissions.
- Side-effect classification.
- Config schema.
- Idempotency strategy.
- Approval requirement.
- Limitations và result schema.

GitHub PR chỉ được báo thành công khi provider xác nhận. CodeCommit branch/commit và review flow phụ thuộc API, IAM permissions và cấu hình môi trường thực tế; không bịa URL hoặc kết quả.

## Approval
- Approval gắn với exact diff hash, destination và operation.
- Revalidate policy/base commit trước publish.
- Lưu actor, approver, thời gian, provider response và resulting ID/URL.
- Không auto-merge hoặc production deploy trong MVP.
- Retry phải tránh duplicate comment/PR/commit khi provider hỗ trợ idempotency.

## Production hardening
- Structured logs, metrics, traces và correlation IDs.
- Queue depth/age, stuck runs, worker health, provider latency/error rate.
- Usage/cost limits và workspace quotas.
- Retention/cleanup cho events, logs và artifacts.
- Backup/restore và rollback runbooks.
- Rate limiting, security regression tests và credential rotation.

## Acceptance criteria
- UI chỉ hiển thị success sau khi provider xác nhận.
- Mọi write/publish side effect có audit.
- Permission và approval được enforce ở server.
- Alerts cho worker outage/stuck runs/queue backlog.
- Backup/restore hoặc recovery procedure được kiểm chứng.
- Release checklist có lint/typecheck/tests/security evidence và known limitations.
