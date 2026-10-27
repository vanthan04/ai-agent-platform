import { z } from "zod";
import { DomainError } from "../../shared-kernel";

/** Points at a stored secret. Safe to keep in a record and to log: it reveals nothing about the secret. */
export const SecretRef = z.string().min(1).max(128).brand<"SecretRef">();
export type SecretRef = z.infer<typeof SecretRef>;

/** The key that encrypts secrets is not set, so nothing can be stored or read. */
export class SecretStorageNotConfiguredError extends DomainError {
  readonly code = "secret_storage_not_configured";
  constructor() {
    super("secret storage is not configured");
  }
}
