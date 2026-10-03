import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server environment; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // RLS tests share one local database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
