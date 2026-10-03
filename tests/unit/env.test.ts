import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "@/lib/env";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
};

describe("env", () => {
  it("accepts the minimum public config", () => {
    expect(parsePublicEnv(base).NEXT_PUBLIC_SUPABASE_URL).toBe(base.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("names the missing variable", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: base.NEXT_PUBLIC_SUPABASE_URL })).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("requires the secret key on the server but not integration variables", () => {
    expect(() => parseServerEnv(base)).toThrow(/SUPABASE_SECRET_KEY/);
    const env = parseServerEnv({ ...base, SUPABASE_SECRET_KEY: "sb_secret_x" });
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it("rejects an unknown QuickBooks environment", () => {
    expect(() => parseServerEnv({ ...base, SUPABASE_SECRET_KEY: "s", QBO_ENVIRONMENT: "prod" })).toThrow(
      /QBO_ENVIRONMENT/,
    );
  });
});
