import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClientHolder } from "../../src/database";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { TenantId } from "../../src/shared-kernel";
import { SecretRef, SecretStorageNotConfiguredError } from "../../src/vault";
import { AesGcmCipher } from "../../src/vault/infrastructure/aes-gcm-cipher";
import { PrismaSecretStore } from "../../src/vault/infrastructure/prisma-secret-store";

const url = process.env["DATABASE_URL"];

describe("PrismaSecretStore without an encryption key", () => {
  it("stores and reveals nothing, and tells why", async () => {
    const store = new PrismaSecretStore(new PrismaClientHolder(undefined), undefined);
    const tenant = TenantId.parse("tenant-1");
    await expect(store.put(tenant, "token-value-123")).rejects.toBeInstanceOf(SecretStorageNotConfiguredError);
    await expect(store.get(tenant, SecretRef.parse("any"))).rejects.toBeInstanceOf(SecretStorageNotConfiguredError);
  });
});

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("PrismaSecretStore (Postgres)", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const holder = new PrismaClientHolder(url);
  const store = new PrismaSecretStore(holder, new AesGcmCipher(randomBytes(32)));
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });

  afterAll(async () => {
    await raw.secret.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await raw.$disconnect();
    await holder.onModuleDestroy();
  });

  it("stores only ciphertext and reads the value back for its own tenant", async () => {
    const ref = await store.put(tenantA, "ghp_plaintext-token-value-777");
    const row = await raw.secret.findUniqueOrThrow({ where: { id: ref } });
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("plaintext-token");
    expect(JSON.stringify(row)).not.toContain("plaintext-token");
    expect(await store.get(tenantA, ref)).toBe("ghp_plaintext-token-value-777");
    expect(await store.get(tenantB, ref)).toBeUndefined();
    expect(await store.get(tenantA, SecretRef.parse("unknown"))).toBeUndefined();
  });

  it("refuses a row whose ciphertext was changed or copied to another reference", async () => {
    const ref = await store.put(tenantA, "another-token-value-888");
    const row = await raw.secret.findUniqueOrThrow({ where: { id: ref } });
    const copyId = randomUUID();
    await raw.secret.create({ data: { id: copyId, tenantId: tenantA, iv: row.iv, ciphertext: row.ciphertext, authTag: row.authTag } });
    await expect(store.get(tenantA, SecretRef.parse(copyId))).rejects.toThrow("could not be decrypted");
    const flipped = Buffer.from(row.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await raw.secret.update({ where: { id: ref }, data: { ciphertext: new Uint8Array(flipped) } });
    await expect(store.get(tenantA, ref)).rejects.toThrow("could not be decrypted");
  });

  it("deletes inside its tenant only, and deleting an unknown reference is fine", async () => {
    const ref = await store.put(tenantA, "token-to-delete-999");
    await store.delete(tenantB, ref);
    expect(await store.get(tenantA, ref)).toBe("token-to-delete-999");
    await store.delete(tenantA, ref);
    expect(await store.get(tenantA, ref)).toBeUndefined();
    await expect(store.delete(tenantA, SecretRef.parse("unknown"))).resolves.toBeUndefined();
  });
});
