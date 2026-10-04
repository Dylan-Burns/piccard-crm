import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * AES-256-GCM for OAuth tokens at rest (spec §6.1). The stored value is
 * base64(iv[12] | auth tag[16] | ciphertext); a wrong key or any tampering fails decryption.
 */
function key(explicit?: string): Buffer {
  const encoded = explicit ?? serverEnv().INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return bytes;
}

export function encrypt(plaintext: string, keyBase64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(stored: string, keyBase64?: string): string {
  const bytes = Buffer.from(stored, "base64");
  if (bytes.length < 28) throw new Error("Encrypted value is too short");
  const decipher = createDecipheriv("aes-256-gcm", key(keyBase64), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
