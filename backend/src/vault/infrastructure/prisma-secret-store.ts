import { randomUUID } from "node:crypto";
import type { PrismaClientHolder } from "../../database";
import type { TenantId } from "../../shared-kernel";
import type { SecretStore } from "../application/secret-store";
import { SecretRef, SecretStorageNotConfiguredError } from "../domain/secret-ref";
import type { AesGcmCipher } from "./aes-gcm-cipher";

const MAX_SECRET_LENGTH = 8_192;

const contextOf = (tenantId: string, ref: string): string => `${tenantId}/${ref}`;

/** Encrypted rows in Postgres. Without a cipher (no key configured) it can delete but never store or reveal. */
export class PrismaSecretStore implements SecretStore {
  constructor(
    private readonly prisma: PrismaClientHolder,
    private readonly cipher: AesGcmCipher | undefined,
  ) {}

  async put(tenantId: TenantId, plaintext: string): Promise<SecretRef> {
    if (!this.cipher) throw new SecretStorageNotConfiguredError();
    if (plaintext.length === 0 || plaintext.length > MAX_SECRET_LENGTH) throw new Error("a secret must have 1 to 8192 characters");
    const ref = SecretRef.parse(randomUUID());
    const encrypted = this.cipher.encrypt(plaintext, contextOf(tenantId, ref));
    // Prisma's `Bytes` wants a plain `Uint8Array`; a Node `Buffer` carries a wider backing type.
    await this.prisma.db().secret.create({
      data: {
        id: ref,
        tenantId,
        iv: new Uint8Array(encrypted.iv),
        ciphertext: new Uint8Array(encrypted.ciphertext),
        authTag: new Uint8Array(encrypted.authTag),
      },
    });
    return ref;
  }

  async get(tenantId: TenantId, ref: SecretRef): Promise<string | undefined> {
    if (!this.cipher) throw new SecretStorageNotConfiguredError();
    const row = await this.prisma.db().secret.findFirst({ where: { id: ref, tenantId } });
    if (!row) return undefined;
    return this.cipher.decrypt({ iv: Buffer.from(row.iv), ciphertext: Buffer.from(row.ciphertext), authTag: Buffer.from(row.authTag) }, contextOf(tenantId, ref));
  }

  async delete(tenantId: TenantId, ref: SecretRef): Promise<void> {
    await this.prisma.db().secret.deleteMany({ where: { id: ref, tenantId } });
  }
}
