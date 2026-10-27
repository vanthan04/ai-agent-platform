# Phase 3 — Durable Execution Engine

## Mục tiêu
Một run được thực thi độc lập với browser request, có trạng thái bền vững, event history, retry và cancellation.

## Thành phần
- API tạo run.
- Durable queue.
- Worker.
- State transition service.
- Run attempts.
- Event persistence.
- Polling ban đầu; SSE khi cần live updates và event delivery đã sẵn sàng.

Chọn queue sau Phase 0 dựa trên hạ tầng và dependency hiện có; không thêm công nghệ chỉ vì phổ biến.

## State machine
```text
QUEUED
  -> RESOLVING_INPUT
  -> RESOLVING_REPOSITORY
  -> PLANNING
  -> WAITING_APPROVAL
  -> EXECUTING
  -> VERIFYING
  -> REVIEWING_OUTPUT
  -> PUBLISHING
  -> SUCCEEDED
```
Terminal/exception states: `FAILED`, `CANCELLED`, `BLOCKED`.

## Yêu cầu
- State transitions được backend validate.
- Lưu start/end timestamps và attempt number.
- API create-run trả nhanh; worker xử lý sau.
- Idempotency key cho tạo run và side effects.
- Retry không ghi đè evidence của attempt trước.
- Cancel có semantics rõ ràng, kể cả khi tool đang chạy.
- Persist events để browser reconnect có thể xem lại.
- Log payload phải giới hạn kích thước và redact secrets.

## Acceptance criteria
- Run tồn tại sau refresh và restart worker.
- Failure/retry/cancel hiển thị đúng.
- Không có state transition không hợp lệ.
- Tests bao phủ duplicate dispatch, retry, cancel và worker failure.
- Có correlation ID nối API, run, attempt và provider calls.
