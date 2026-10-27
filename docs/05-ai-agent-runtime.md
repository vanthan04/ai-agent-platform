# Phase 5 — AI Agent Runtime

## Mục tiêu
Tạo agent workflow có thể phân tích task, xem repository trong phạm vi được phép, tạo plan và report có cấu trúc.

## Kiến trúc
Có thể dùng Python + FastAPI cho AI runtime. Chỉ thêm LangGraph khi cần workflow stateful, branching hoặc checkpoint/recovery mà implementation đơn giản không đáp ứng.

Runtime là một execution component, không phải giao diện người dùng và không thay thế NestJS trong auth/RBAC.

## Workflow
1. Validate input snapshot, provider config và policy.
2. Resolve repository snapshot/commit.
3. Analyze task và acceptance criteria.
4. Đọc các file liên quan qua read-only tools.
5. Tạo implementation plan.
6. Tạo verification plan.
7. Trả structured report.
8. Persist steps, tool calls, errors và usage.

## Structured plan schema
- `summary`
- `assumptions`
- `affectedAreas`
- `steps`
- `risks`
- `verificationPlan`
- `requiredApprovals`
- `openQuestions`

## Structured report schema
- `summary`
- `findings`
- `evidence`
- `limitations`
- `artifacts`
- `usage`
- `nextActions`

## Tool security
- Tool registry có stable ID/version, input/output schema, permission, timeout và audit.
- Backend/worker enforce permission; model không tự cấp quyền.
- Jira content, README, repo files và tool outputs là untrusted data.
- Giới hạn tool count, execution time, output size và model budget.
- Không báo tests pass nếu chưa thực thi command và lưu exit code.

## Acceptance criteria
- Output validate được bằng schema.
- Evidence/file references có nguồn thực tế.
- Mơ hồ hoặc thiếu permission dẫn tới `BLOCKED`/open question.
- Có evaluation fixtures cho task rõ ràng, mơ hồ, unsafe và impossible.
- Phase này chỉ read-only analysis/report, chưa sửa code.
