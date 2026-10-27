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

Bổ sung 2026-10-27 (D7–D9 trong `decisions.md`):
- `Project`: tên, repository và nhánh được phép; `Task` và `Run` mang `projectId`. Project nằm dưới tenant duy nhất (D2); trong tài liệu này "workspace" có thể hiểu là project cho đến khi O7 được chốt.
- `ProjectMember`: vai trò theo từng dự án (D12).
- `PolicyVersion`: nội dung policy có thể sửa của một dự án, có số phiên bản, người sửa, thời gian. Mỗi run ghi lại phiên bản đã dùng. Baseline nằm trong code, không lưu ở đây.
- `McpConnection`: dự án, tên, transport (giai đoạn đầu chỉ HTTP từ xa, D11), địa chỉ, trạng thái kết nối, tham chiếu secret (không lưu giá trị secret), danh sách tool đã phát hiện kèm quyết định `allow` hoặc `ask`.

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
Bổ sung 2026-10-27 (đề xuất):
```text
GET|POST         /projects
GET|PATCH        /projects/:projectId
GET              /projects/:projectId/policy
PUT              /projects/:projectId/policy          (tạo PolicyVersion mới)
GET              /projects/:projectId/policy/versions
GET|POST         /projects/:projectId/mcp-connections
PATCH|DELETE     /projects/:projectId/mcp-connections/:connectionId
POST             /projects/:projectId/mcp-connections/:connectionId/test
GET              /projects/:projectId/mcp-connections/:connectionId/tools
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
- Secret không được trả về browser hoặc ghi log (kể cả secret của MCP).
- Truy cập chéo dự án bị từ chối: có test với hai dự án.
- Sửa policy không thể nới baseline (D8): có test từ chối từng quy tắc baseline; mỗi lần sửa có phiên bản và audit.
- Chỉ PM hoặc PL của dự án (D10) mới sửa policy hoặc kết nối MCP, kiểm tra ở server.
- Config/provider không hợp lệ bị từ chối với lỗi an toàn, dễ hiểu.
- Migrations, tests và API documentation được cập nhật theo convention hiện có.
