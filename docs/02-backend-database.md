# Phase 2 — Backend, database và configuration API

## Mục tiêu
Lưu dữ liệu thật, quản lý quyền và cung cấp provider/config API cho frontend.

## Stack mục tiêu
NestJS + TypeScript, Prisma và PostgreSQL, trừ khi Phase 0 phát hiện project hiện tại đã có lựa chọn tương đương hợp lý.

## Module dự kiến
- Auth và users.
- Workspaces/memberships.
- RBAC/permissions.
- Integration connections.
- Provider registry.
- Execution configs.
- Task runs và events.
- Approvals, artifacts, audit và usage (triển khai dần theo nhu cầu).

Không tạo tất cả module/bảng trước khi use case cần chúng.

## Entity candidates
- `User`, `Workspace`, `WorkspaceMember`.
- `Role`, `Permission`, `RolePermission` nếu RBAC được quản lý trong DB.
- `IntegrationConnection`: provider, workspace, connection status, external metadata, secret reference.
- `RepositoryMapping`: project/Jira project tới repository và allowed branches.
- `ExecutionConfig`: workflow/version, input provider/config, source-control provider/config, output provider/config, approval policy, limits.
- `TaskRun`, `RunAttempt`, `RunEvent`, `Artifact`, `ApprovalRequest`, `AuditEvent`, `UsageRecord`.
- `RunSourceSnapshot` để ghi lại input và repository version đã dùng.

## API đề xuất
```text
GET    /workspaces/:id/providers
GET    /workspaces/:id/execution-configs
POST   /workspaces/:id/execution-configs
PATCH  /execution-configs/:configId
POST   /workspaces/:id/runs
GET    /workspaces/:id/runs
GET    /runs/:runId
GET    /runs/:runId/events
POST   /runs/:runId/cancel
POST   /runs/:runId/retry
```
Đây là contract đề xuất; phải đối chiếu convention hiện có trước khi implement.

## Dynamic provider contract
Provider descriptor tối thiểu:
- `id`, `displayName`, `category`, `version`.
- `capabilities`.
- `configSchema`.
- `requiredPermissions`.
- `setupStatus` hoặc connection status.
- `limitations`.

Frontend dùng schema để render form. Backend là authority cuối cùng và phải validate cấu hình theo schema/version của provider. Không thực thi code được gửi trong schema; chỉ cho phép field types/conditional logic được allowlist.

## Acceptance criteria
- CRUD config hoạt động và dữ liệu còn sau reload.
- API kiểm tra identity, workspace membership và resource permissions.
- Secret không được trả về browser hoặc ghi log.
- Config/provider không hợp lệ bị từ chối với lỗi an toàn, dễ hiểu.
- Migrations, tests và API documentation được cập nhật theo convention hiện có.
