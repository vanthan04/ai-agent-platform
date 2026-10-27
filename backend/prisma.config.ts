import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` does not connect, so a missing DATABASE_URL must not stop it; migrate commands fail with a clear connection error instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] ?? "" },
});
