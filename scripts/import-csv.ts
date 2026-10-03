/**
 * Imports customers (with an optional property and open deal) from a CSV file (spec §9 Phase 5).
 *
 *   pnpm tsx scripts/import-csv.ts customers.csv              dry run: reports what would happen
 *   pnpm tsx scripts/import-csv.ts customers.csv --commit     writes
 *
 * Target database: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment, else .env.local.
 * To import into staging or production, pass that project's values on the command line:
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... pnpm tsx scripts/import-csv.ts file.csv
 *
 * Columns (header row required; names are case-insensitive; extra columns are ignored):
 *   first_name, last_name  (or name)        phone, email            (one of the two is required)
 *   address, city, state, zip               service / work_type     roof_replacement, "Roof repair", ...
 *   stage                                   new | contacted | qualified | inspection_scheduled | estimate_sent | negotiation
 *   owner_email                             must match an active admin or sales user
 *   value                                   dollars, e.g. 24,800
 *   source                                  a lead source name, e.g. Referral
 *   notes                                   becomes the deal description
 *
 * Every row goes through create_lead with channel 'import' (spec §6.5): no auto-merge, a row whose
 * customer and address already have an open deal is skipped, stage gates are bypassed, each deal
 * gets one "confirm stage and next step" task, and no emails are sent.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { guessWorkType } from "../src/features/leads/normalize";
import { parseDollarsToCents } from "../src/lib/money";
import { toE164 } from "../src/lib/phone";
import type { Database, Json } from "../src/types/database";

loadEnv({ path: ".env.local", quiet: true });

const OPEN_STAGES = ["new", "contacted", "qualified", "inspection_scheduled", "estimate_sent", "negotiation"];

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

type Row = Record<string, string>;

export function toLead(row: Row, owners: Map<string, string>): { lead: Record<string, unknown> } | { error: string } {
  const get = (...names: string[]) => names.map((n) => row[n]?.trim()).find(Boolean) ?? "";
  let first = get("first_name", "first");
  let last = get("last_name", "last");
  if (!first && get("name")) {
    const parts = get("name").split(/\s+/);
    first = parts[0] ?? "";
    last = parts.slice(1).join(" ");
  }
  const phone = get("phone", "mobile", "cell");
  const email = get("email").toLowerCase();
  if (!first) return { error: "no name" };
  if (!phone && !email) return { error: "no phone or email" };

  const stage = get("stage").toLowerCase().replace(/[\s/-]+/g, "_") || "new";
  if (!OPEN_STAGES.includes(stage)) return { error: `stage "${get("stage")}" is not an open stage` };
  const ownerEmail = get("owner_email", "owner").toLowerCase();
  if (ownerEmail && !owners.has(ownerEmail)) return { error: `owner "${ownerEmail}" is not an active admin or sales user` };
  const value = get("value", "amount");
  const cents = value ? parseDollarsToCents(value) : null;
  if (value && cents === null) return { error: `value "${value}" is not an amount` };

  return {
    lead: {
      channel: "import",
      import_stage: stage,
      first_name: first,
      last_name: last,
      phone,
      phone_e164: toE164(phone),
      email,
      address_line1: get("address", "address_line1", "street"),
      city: get("city"),
      state: get("state"),
      postal_code: get("zip", "postal_code"),
      work_type: guessWorkType(get("work_type", "service")),
      message: get("notes", "description"),
      source_name: get("source"),
      owner_id: ownerEmail ? owners.get(ownerEmail) : "",
      estimated_value_cents: cents ?? "",
    },
  };
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error("usage: pnpm tsx scripts/import-csv.ts <file.csv> [--commit]");
  const commit = flags.includes("--commit");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");

  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: staff, error } = await db.from("profiles").select("id, email").in("role", ["admin", "sales"]).eq("is_active", true);
  if (error) throw error;
  const owners = new Map(staff.map((p) => [p.email.toLowerCase(), p.id]));

  const [header, ...lines] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  if (!header) throw new Error("The file is empty");
  const columns = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const counts = { created: 0, skipped: 0, invalid: 0, failed: 0 };

  console.log(`${commit ? "IMPORTING INTO" : "Dry run against"} ${new URL(url).host}: ${lines.length} rows`);
  for (const [index, values] of lines.entries()) {
    const line = index + 2;
    const row: Row = Object.fromEntries(columns.map((c, i) => [c, values[i] ?? ""]));
    const mapped = toLead(row, owners);
    if ("error" in mapped) {
      counts.invalid += 1;
      console.log(`  line ${line}: invalid (${mapped.error})`);
      continue;
    }
    if (!commit) {
      // Dry run: report an existing customer so the operator knows what the real run will attach to.
      const { lead } = mapped;
      const match = lead.phone_e164
        ? await db.from("customers").select("id").eq("phone_e164", lead.phone_e164 as string).limit(1)
        : lead.email
          ? await db.from("customers").select("id").eq("email", lead.email as string).limit(1)
          : { data: [] };
      counts.created += 1;
      if (match.data?.length) console.log(`  line ${line}: would attach to an existing customer (${lead.first_name} ${lead.last_name})`);
      continue;
    }
    const { data, error: rpcError } = await db.rpc("create_lead", { p: mapped.lead as Json });
    const result = data as { ok?: boolean; status?: string; message?: string } | null;
    if (rpcError || !result?.ok) {
      counts.failed += 1;
      console.log(`  line ${line}: failed (${rpcError?.message ?? result?.message ?? "unknown"})`);
    } else if (result.status === "skipped") {
      counts.skipped += 1;
      console.log(`  line ${line}: skipped (customer already has an open deal at this address)`);
    } else {
      counts.created += 1;
    }
  }
  console.log(
    commit
      ? `Done. Created ${counts.created}, skipped ${counts.skipped}, invalid ${counts.invalid}, failed ${counts.failed}.`
      : `Dry run. ${counts.created} rows would be imported, ${counts.invalid} are invalid. Re-run with --commit to write.`,
  );
}

// Run only when executed directly (the tests import parseCsv and toLead).
if (process.argv[1]?.endsWith("import-csv.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
