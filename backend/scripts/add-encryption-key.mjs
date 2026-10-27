#!/usr/bin/env node
// Adds SECRETS_ENCRYPTION_KEY to backend/.env: base64 of 32 random bytes, the key that encrypts stored MCP tokens (D21).
// The key is never printed. An existing key is never changed: replacing it would make every stored token unreadable.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "SECRETS_ENCRYPTION_KEY";
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

if (!existsSync(envPath)) {
  console.error("backend/.env does not exist. Create it first (see \"Local setup\" in backend/README.md), then run this again.");
  process.exit(1);
}

const current = readFileSync(envPath, "utf8");

if (new RegExp(`^\\s*${NAME}\\s*=`, "m").test(current)) {
  console.log(`backend/.env already has a ${NAME} line. Left unchanged.`);
  process.exit(0);
}

const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
appendFileSync(envPath, `${separator}${NAME}=${randomBytes(32).toString("base64")}\n`, { encoding: "utf8" });

console.log(`Added ${NAME} to backend/.env (the value is not shown).`);
console.log("Back it up somewhere safe: if it is lost, stored MCP tokens cannot be read and must be entered again.");
