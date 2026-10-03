import { fail, type ActionResult } from "@/lib/result";

/** Shape every lifecycle RPC returns (spec §4.6). */
export type RpcResult = { ok: boolean; code?: string; message?: string; missing?: string[] } & Record<string, unknown>;

/** Converts an RPC response into an ActionResult failure, or returns the successful payload. */
export function unwrapRpc<T extends RpcResult>(
  response: { data: unknown; error: { code?: string; message: string } | null },
): { ok: true; data: T } | ActionResult<never> {
  if (response.error) {
    if (response.error.code === "42501") return fail("forbidden", "You do not have permission to do that");
    return fail("rpc_failed", "Something went wrong. Please try again.");
  }
  const data = response.data as T | null;
  if (!data) return fail("rpc_failed", "Something went wrong. Please try again.");
  if (!data.ok) return fail(data.code ?? "failed", data.message ?? "That could not be done");
  return { ok: true, data };
}
