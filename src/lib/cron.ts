import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/** Cron routes accept only `Authorization: Bearer <CRON_SECRET>` (spec §6.1). Vercel Cron sends this header. */
export function isAuthorizedCron(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
