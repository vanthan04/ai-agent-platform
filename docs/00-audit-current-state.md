# Phase 0 — Audit hiện trạng và chốt kiến trúc

## Mục tiêu
Hiểu repository, quy ước và `harness-engineering` hiện tại để lên kế hoạch dựa trên bằng chứng, tránh tạo lại thứ đã có.

## Phạm vi công việc
1. Kiểm tra cấu trúc repository, package manager, framework versions, scripts, CI và test setup.
2. Kiểm tra instructions, manifest, rules, skills, workflows, adapters và verification commands trong harness.
3. Xác định project boundaries và cách coding agent được phép truy cập các repository.
4. Kiểm tra auth, database, API conventions, UI library, logging và deployment hiện có.
5. Lập danh sách capability có thể reuse, capability còn thiếu và rủi ro trùng lặp.
6. Chốt hoặc ghi rõ các quyết định còn mở: repo layout, auth, queue, event transport, provider contract, sandbox.
7. Đề xuất Phase 1 nhỏ nhất có thể triển khai.

## Ranh giới bắt buộc
- `harness-engineering`: tooling/rules/skills hỗ trợ coding agent trong quá trình phát triển.
- `AI Engineering Agent Platform`: sản phẩm độc lập, gồm UI, API, run orchestration, integrations, worker, policy và artifacts.
- Có thể dùng harness để xây sản phẩm; không tự động gộp runtime của sản phẩm vào harness.
- Không tạo archive, skill, adapter hoặc module mới nếu chưa chứng minh là cần thiết.

## Bảo mật
Không đọc `.env`, token, private key, credentials, production dumps hoặc file được đánh dấu protected. Không thực hiện thay đổi code, cài dependency, gọi API bên ngoài hay tạo tài nguyên cloud trong phase này.

## Deliverables
- Current-state architecture map.
- Danh sách file/module hiện có có thể tái sử dụng.
- Gap list và duplicate-risk list.
- Các quyết định kiến trúc và lý do.
- Verification commands hiện có.
- Roadmap theo dependency.
- Danh sách file dự kiến thay đổi ở Phase 1.

## Acceptance criteria
- Mọi kết luận về capability hiện có đều có bằng chứng từ file/code.
- Không sửa đổi repository.
- Không đọc secrets/protected files.
- Phân biệt rõ fact, assumption và recommendation.
- Có checklist cụ thể cho Phase 1.
