import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z.string().min(1).optional(),
  /** Only `dev` exists today: one fixed user. Real authentication replaces it before anything is deployed. */
  AUTH_MODE: z.enum(["dev"]).default("dev"),
  DEV_USER_ID: z.string().min(1).max(128).default("dev-user"),
  DEV_TENANT_ID: z.string().min(1).max(128).default("default"),
  /** Base64 of 32 random bytes; encrypts stored secrets. Without it the app starts but cannot store a secret. */
  SECRETS_ENCRYPTION_KEY: z.string().min(1).optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string | undefined;
  auth: { mode: "dev"; userId: string; tenantId: string };
  /** Decoded encryption key for stored secrets, if one is configured. */
  secretsKey: Buffer | undefined;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

/** Reads the environment once, at start. Fails closed: dev authentication is never accepted in production. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`invalid configuration: ${names}`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === "production" && value.AUTH_MODE === "dev") {
    throw new Error("invalid configuration: AUTH_MODE=dev is not allowed in production");
  }
  const secretsKey = value.SECRETS_ENCRYPTION_KEY ? Buffer.from(value.SECRETS_ENCRYPTION_KEY, "base64") : undefined;
  if (secretsKey && secretsKey.length !== 32) {
    throw new Error("invalid configuration: SECRETS_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    auth: { mode: value.AUTH_MODE, userId: value.DEV_USER_ID, tenantId: value.DEV_TENANT_ID },
    secretsKey,
  };
}
