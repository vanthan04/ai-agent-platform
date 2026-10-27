# Phase 6 — Sandbox và code execution

## Mục tiêu
Cho phép agent sửa code và chạy verification trong môi trường cô lập, không trực tiếp thực thi task tùy ý trên API host.

## Công việc
1. Tạo sandbox/workspace riêng theo run và attempt.
2. Checkout đúng base commit.
3. Áp dụng giới hạn CPU, memory, disk, thời gian và output.
4. Hạn chế network egress.
5. Không mount host Docker socket hoặc filesystem tùy ý.
6. Chạy allowlisted lint/typecheck/test commands.
7. Thu thập diff, changed files, command summaries, exit codes và artifacts.
8. Hỗ trợ cancellation và cleanup ở mọi terminal state.
9. Redact secrets khỏi logs/artifacts.
10. Yêu cầu review/approval trước khi publish.

## Quy tắc
- Không tin command được đề xuất bởi model nếu chưa qua policy.
- Không đưa credentials rộng quyền vào sandbox.
- Không để code task đọc secrets của host.
- Phân biệt command đã chạy với command dự kiến chạy.
- Không tự push, merge hoặc deploy.

## Acceptance criteria
- Sandbox isolation và resource limits đã được kiểm thử.
- Test evidence có exit code thực.
- Timeout, cancellation, crash và cleanup được test.
- Diff có thể xem lại trước publish.
- Không có secret leakage trong logs hoặc artifacts.
