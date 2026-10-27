# AI Engineering Agent Platform — Implementation Plan

## Mục tiêu
Xây dựng một AI Engineering Agent Platform có giao diện Next.js, backend quản lý nghiệp vụ, execution engine bất đồng bộ, tích hợp Jira và source control, đồng thời cho phép cấu hình input/output thông qua provider registry thay vì hard-code.

## Thứ tự triển khai
1. [Phase 0 — Audit hiện trạng](./00-audit-current-state.md)
2. [Phase 1 — Frontend Next.js](./01-frontend-nextjs.md)
3. [Phase 2 — Backend và database](./02-backend-database.md)
4. [Phase 3 — Execution Engine](./03-execution-engine.md)
5. [Phase 4 — Input và integrations](./04-input-integrations.md)
6. [Phase 5 — AI Agent Runtime](./05-ai-agent-runtime.md)
7. [Phase 6 — Sandbox và code execution](./06-sandbox-code-execution.md)
8. [Phase 7 — Output, approval và production](./07-output-approval-production.md)
9. [Prompt templates](./08-ai-coding-agent-prompts.md)

## Nguyên tắc
- Audit repository và `harness-engineering` trước khi sửa code.
- Chỉ triển khai một phase hoặc vertical slice mỗi lần.
- Tái sử dụng convention và capability hiện có; không tạo trùng module/skill.
- UI có thể cấu hình động, nhưng backend phải validate schema, quyền và capabilities.
- Không chạy agent job dài đồng bộ trong HTTP request.
- Không để LLM tự đoán repository đích.
- Không publish, merge, deploy hoặc thực hiện side effect bên ngoài nếu chưa được cấp quyền/phê duyệt.
- Mọi tuyên bố test pass phải có command đã chạy và bằng chứng thực tế.

## Kiến trúc mục tiêu (đề xuất)
- Frontend: Next.js App Router + TypeScript.
- Backend: NestJS + Prisma + PostgreSQL.
- Queue/worker: chọn theo hạ tầng và dependency hiện tại sau Phase 0.
- AI runtime: có thể dùng Python + FastAPI; cân nhắc LangGraph nếu workflow thực sự cần state/checkpoint.
- Integrations: Jira, GitHub, AWS CodeCommit qua adapter.
- Sandbox: môi trường cô lập cho code execution.
- Đây là kiến trúc đề xuất, không phải quyết định cuối cùng trước khi audit codebase.
