import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface Encrypted {
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

/**
 * AES-256-GCM. Each value gets a fresh random IV. The `context` (tenant and reference) is authenticated with the value, so
 * a ciphertext copied to another row, or tampered with, fails to decrypt instead of yielding something.
 */
export class AesGcmCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("the encryption key must be 32 bytes");
  }

  encrypt(plaintext: string, context: string): Encrypted {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { iv, ciphertext, authTag: cipher.getAuthTag() };
  }

  decrypt(encrypted: Encrypted, context: string): string {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, encrypted.iv);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(encrypted.authTag);
      return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("a stored secret could not be decrypted");
    }
  }
}
