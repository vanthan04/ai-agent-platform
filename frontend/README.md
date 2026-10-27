# frontend

The user interface: Next.js (App Router) and TypeScript. Planned for repository phase 3 (task UI on a fake executor); see `../docs/decisions.md`.

Owns: routes and layouts, task and run screens, dynamic input and output forms rendered from provider descriptors, loading, empty and error states, and the project screens: add a project, edit its policy, connect MCP servers (D7 to D9 in `../docs/decisions.md`).

Does not own: authentication decisions, permission checks, schema validation of provider configuration, or long-running work. The backend is the authority; the UI only displays and requests. Never run an agent job inside a Next.js request.

Data comes through a repository layer so a fake executor can be replaced by the backend API without rewriting screens. Types shared with the backend are decided when this app is created (generated client or a shared package).

Not created yet: no `package.json`, no framework installed. By D13 it is built after the backend API, from a fake executor.
