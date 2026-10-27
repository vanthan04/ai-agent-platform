import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmCipher } from "../../src/vault/infrastructure/aes-gcm-cipher";

const cipher = () => new AesGcmCipher(randomBytes(32));

describe("AesGcmCipher", () => {
  it("decrypts what it encrypted", () => {
    const c = cipher();
    const text = "ghp_abcdefghijklmnop — ünïcode ✓";
    expect(c.decrypt(c.encrypt(text, "tenant/ref"), "tenant/ref")).toBe(text);
  });

  it("does not leave the plaintext in the ciphertext, and uses a fresh IV every time", () => {
    const c = cipher();
    const a = c.encrypt("super-secret-token-value", "ctx");
    const b = c.encrypt("super-secret-token-value", "ctx");
    expect(a.ciphertext.toString("utf8")).not.toContain("super-secret");
    expect(a.ciphertext.includes(Buffer.from("super-secret"))).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv).toHaveLength(12);
    expect(a.authTag).toHaveLength(16);
  });

  it("refuses a value moved to another tenant or reference", () => {
    const c = cipher();
    const encrypted = c.encrypt("token-value-123", "tenant-1/ref-1");
    expect(() => c.decrypt(encrypted, "tenant-2/ref-1")).toThrow("could not be decrypted");
    expect(() => c.decrypt(encrypted, "tenant-1/ref-2")).toThrow("could not be decrypted");
  });

  it("refuses tampered ciphertext, IV or tag, and the wrong key", () => {
    const c = cipher();
    const encrypted = c.encrypt("token-value-123", "ctx");
    const flip = (buffer: Buffer): Buffer => Buffer.concat([Buffer.from([(buffer[0] ?? 0) ^ 0xff]), buffer.subarray(1)]);
    expect(() => c.decrypt({ ...encrypted, ciphertext: flip(encrypted.ciphertext) }, "ctx")).toThrow();
    expect(() => c.decrypt({ ...encrypted, iv: flip(encrypted.iv) }, "ctx")).toThrow();
    expect(() => c.decrypt({ ...encrypted, authTag: flip(encrypted.authTag) }, "ctx")).toThrow();
    expect(() => cipher().decrypt(encrypted, "ctx")).toThrow();
  });

  it("does not put the plaintext or the key into its error message", () => {
    const key = randomBytes(32);
    const c = new AesGcmCipher(key);
    const encrypted = c.encrypt("plain-secret-value-xyz", "ctx");
    try {
      c.decrypt(encrypted, "other");
    } catch (error) {
      expect((error as Error).message).not.toContain("plain-secret-value-xyz");
      expect((error as Error).message).not.toContain(key.toString("base64"));
    }
  });

  it("needs a 32-byte key", () => {
    expect(() => new AesGcmCipher(randomBytes(16))).toThrow("32 bytes");
    expect(() => new AesGcmCipher(randomBytes(33))).toThrow("32 bytes");
  });
});
