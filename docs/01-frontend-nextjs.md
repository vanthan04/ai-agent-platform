# Phase 1 — Frontend Next.js

## Mục tiêu
Xây dựng UI gần với ảnh tham khảo, trước tiên dùng mock data có kiểu dữ liệu rõ ràng, nhưng thiết kế để sau này thay data source bằng API thật mà không phải viết lại toàn bộ UI.

## Routes tối thiểu
- `/execution/tasks`: danh sách execution tasks.
- `/execution/runs`: danh sách các lần chạy.
- `/execution/setup`: cấu hình input, source control, workflow và output.
- `/runs/[runId]`: chi tiết một lần chạy.
- Chỉ tạo route khác khi cần và phù hợp cấu trúc hiện tại.

### Bổ sung 2026-10-27: dự án, policy và MCP (D7–D9 trong `decisions.md`)
- `/projects`: danh sách dự án và nút thêm dự án; `/projects/new`: form tạo dự án (tên, repository, nhánh được phép).
- `/projects/[projectId]/settings/policy`: xem và sửa policy của dự án.
- `/projects/[projectId]/settings/mcp`: kết nối và quản lý MCP server.
- Các route `/execution/*` và `/runs/[runId]` thuộc về dự án đang chọn; header có bộ chọn dự án. Mỗi dự án lưu riêng repository, policy, kết nối MCP, task và run.
- Màn hình policy: hiển thị phần baseline không sửa được kèm lý do (chỉ đọc), phần sửa được, diff so với phiên bản trước và lịch sử phiên bản. Chỉ PM hoặc PL của dự án (D10) mới thấy nút lưu; DEV chỉ xem và đề xuất, control bị disabled kèm lý do.
- Màn hình MCP: nhập cấu hình server, nút thử kết nối, danh sách tool phát hiện được với quyết định `allow` hoặc `ask` cho từng tool. Secret nhập một lần, không bao giờ hiển thị lại.
- UI chỉ gửi yêu cầu; backend mới là nơi kiểm tra quyền và chặn mọi chỉnh sửa nới lỏng baseline.

## UI cần có
- Sidebar, header, navigation và user menu.
- Tabs và metric cards: Ready, Blocked, In progress, Completed today.
- Search, status filter, type filter.
- Task rows có expand/collapse.
- Planning, dependencies, progress, attempts và logs.
- Run timeline, artifacts và error/blocked reason.
- Dynamic input/output forms.
- Loading, empty, error, disconnected, unauthorized và success states.
- Responsive layout và accessibility cơ bản.

## Tận dụng Next.js
- App Router cho route/layout.
- Server Components mặc định cho initial rendering/data loading.
- Client Components cho form tương tác, filter, tabs, expandable rows và live logs.
- Server Actions cho mutation ngắn nếu phù hợp convention.
- Route Handlers cho OAuth callback, webhook hoặc SSE proxy khi cần.
- `loading.tsx`, `error.tsx`, `not-found.tsx`, `Suspense` cho trạng thái route.
- Cache/revalidation có chủ đích; không shared-cache dữ liệu riêng theo user/workspace.
- Không chạy agent jobs dài trong request Next.js.

## Cấu trúc tham khảo
Điều chỉnh theo codebase hiện tại; không tái cấu trúc nếu không có lý do:
```text
src/
  app/
    (dashboard)/
      execution/tasks/page.tsx
      execution/runs/page.tsx
      execution/setup/page.tsx
      runs/[runId]/page.tsx
    error.tsx
    not-found.tsx
    loading.tsx
  components/
    layout/
    execution/
    integrations/
    forms/
    ui/
  lib/
    schemas/
    api/
    auth/
```

## Mock-data boundary
- Đặt mock fixtures riêng biệt.
- Có interface/repository layer để thay mock bằng API.
- Không giả vờ mock data là dữ liệu live.
- Không hard-code provider options bên trong từng component; dùng descriptor fixtures ở giai đoạn prototype rồi thay bằng provider registry API.

## Acceptance criteria
- Search/filter cập nhật danh sách thật sự.
- Tabs, expand/collapse và navigation hoạt động.
- Chọn provider đổi form cấu hình.
- Mọi control hoạt động hoặc được disabled kèm lý do.
- Có responsive, loading, empty và error states.
- Thêm dự án trong UI, chuyển dự án, và dữ liệu của dự án này không hiện ở dự án khác.
- Sửa policy và kết nối MCP có trạng thái lưu, lỗi và bị từ chối do thiếu quyền; secret MCP không hiện lại sau khi lưu.
- Có component tests và ít nhất một E2E flow UI quan trọng.
- Lint/typecheck/tests đã chạy thật và báo kết quả.
