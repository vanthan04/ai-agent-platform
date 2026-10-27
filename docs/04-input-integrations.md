# Phase 4 — Input và integrations

## Mục tiêu
Cho phép chọn nguồn input và repository một cách rõ ràng, có thể mở rộng qua adapter.

## Thứ tự triển khai
1. `custom_prompt`.
2. Jira issue read-only.
3. Repository mapping.
4. Source-control provider đầu tiên read-only.
5. Source-control provider thứ hai sau khi contract ổn định.

## Input provider
Mỗi input adapter cần:
- `id`, `version`, config schema.
- Connection validation.
- Fetch/normalize operation.
- Permission requirements.
- Error model và retryability.
- Normalized immutable snapshot.

Snapshot có thể gồm source ID/URL, title, description, acceptance criteria, metadata được phép, source updated timestamp, fetched timestamp và content hash.

## Jira
- Đọc issue và các field được phép.
- Kiểm tra credentials/permissions.
- Xử lý issue không tồn tại, không có quyền hoặc đã thay đổi.
- Nội dung issue là untrusted input; không thể override platform policy.
- Phase này chưa tạo comment/update Jira.

## Source control
- Chọn provider đầu tiên dựa trên quyền truy cập và môi trường thật.
- Đọc repository metadata, branch, tree/file contents và commit SHA.
- Ghi lại exact base commit SHA của mỗi run.
- Giới hạn repo/branch theo workspace policy.

## Repository resolution precedence
1. Người dùng chọn repo rõ ràng.
2. Approved project/workspace mapping.
3. Trusted metadata xác định duy nhất và được policy cho phép.
4. Nếu vẫn mơ hồ: `BLOCKED`, yêu cầu người dùng chọn.

Không để LLM tự chọn repository để ghi code chỉ từ nội dung task.

## Acceptance criteria
- Preview được normalized input trước khi run.
- Connection/permission errors có thông báo an toàn.
- Repo target và commit SHA được lưu lại.
- Contract tests cho provider.
- Không có write/publish side effect trong phase này.
