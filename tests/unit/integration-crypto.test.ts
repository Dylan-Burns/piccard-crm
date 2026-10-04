import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/integrations/crypto";

const key = randomBytes(32).toString("base64");

describe("token encryption", () => {
  it("round-trips, and never produces the same ciphertext twice", () => {
    const token = "ya29.a0Af-example-token/with+symbols==";
    const a = encrypt(token, key);
    const b = encrypt(token, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain(token);
    expect(decrypt(a, key)).toBe(token);
    expect(decrypt(b, key)).toBe(token);
    expect(decrypt(encrypt("", key), key)).toBe("");
    expect(decrypt(encrypt("ünïcode ✓", key), key)).toBe("ünïcode ✓");
  });

  it("fails on a wrong key, tampering, or a malformed key", () => {
    const stored = encrypt("secret", key);
    expect(() => decrypt(stored, randomBytes(32).toString("base64"))).toThrow();
    const bytes = Buffer.from(stored, "base64");
    bytes[bytes.length - 1]! ^= 1;
    expect(() => decrypt(bytes.toString("base64"), key)).toThrow();
    expect(() => decrypt("short", key)).toThrow();
    expect(() => encrypt("x", Buffer.from("too short").toString("base64"))).toThrow(/32 bytes/);
  });
});
