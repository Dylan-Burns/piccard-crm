import "server-only";
import { age, dueState, formatDate } from "@/lib/dates";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Stage = Database["public"]["Enums"]["opportunity_stage"];

export type BoardFilters = { owner?: string; workType?: string; source?: string; q?: string };

export type NextStep =
  | { kind: "overdue" | "today" | "task"; label: string }
  | { kind: "appointment"; label: string }
  | { kind: "none"; label: string };

/** Everything a board card and its dialogs need, already formatted. Plain data so it can cross to the client. */
export type BoardDeal = {
  id: string;
  customerId: string;
  name: string;
  subtitle: string;
  stage: Stage;
  value: string | null;
  valueCents: number;
  ownerId: string | null;
  ownerInitials: string | null;
  inStage: string;
  next: NextStep;
  insurance: boolean;
  phone: string | null;
  email: string | null;
  hasProperty: boolean;
  workType: string | null;
  sentEstimates: { id: string; label: string; total: string }[];
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Open deals plus deals won or lost in the last 30 days (spec §5.5). */
export async function getBoard(filters: BoardFilters, timeZone: string) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let query = supabase
    .from("opportunities")
    .select(
      `id, title, stage, work_type, estimated_value_cents, amount_cents, stage_entered_at, owner_id, is_insurance_claim,
       customer_id, property_id,
       customer:customers!inner(first_name, last_name, phone, email),
       property:properties(address_line1, city),
       owner:profiles!opportunities_owner_id_fkey(full_name),
       tasks(due_at, status),
       appointments(starts_at, status),
       estimates(id, estimate_number, version, status, total_cents)`,
    )
    .or(`stage.not.in.(won,lost),won_at.gte.${since},lost_at.gte.${since}`)
    .order("stage_entered_at", { ascending: false })
    .range(0, 499);
  if (filters.owner === "unassigned") query = query.is("owner_id", null);
  else if (filters.owner) query = query.eq("owner_id", filters.owner);
  if (filters.workType) query = query.eq("work_type", filters.workType as Database["public"]["Enums"]["work_type"]);
  if (filters.source) query = query.eq("source_id", filters.source);

  const { data, error } = await query;
  if (error) throw error;
  const now = new Date();
  const q = filters.q?.trim().toLowerCase();

  const deals: BoardDeal[] = data
    .map((o) => {
      const name = `${o.customer.first_name} ${o.customer.last_name}`.trim();
      const nextTask = o.tasks.filter((t) => t.status === "open").sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
      const nextAppt = o.appointments
        .filter((a) => a.status === "scheduled" && new Date(a.starts_at) > now)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      let next: NextStep;
      if (nextTask) {
        const state = dueState(nextTask.due_at, timeZone, now);
        next =
          state === "overdue"
            ? { kind: "overdue", label: "Overdue" }
            : state === "today"
              ? { kind: "today", label: "Due today" }
              : nextAppt && nextAppt.starts_at < nextTask.due_at
                ? { kind: "appointment", label: formatDate(nextAppt.starts_at, timeZone) }
                : { kind: "task", label: formatDate(nextTask.due_at, timeZone) };
      } else if (nextAppt) {
        next = { kind: "appointment", label: formatDate(nextAppt.starts_at, timeZone) };
      } else {
        next = { kind: "none", label: "No next step" };
      }
      const cents = o.amount_cents ?? o.estimated_value_cents ?? 0;
      return {
        id: o.id,
        customerId: o.customer_id,
        name,
        subtitle: [o.work_type ? WORK_TYPE_LABELS[o.work_type] : "Type not set", o.property?.city].filter(Boolean).join(" · "),
        stage: o.stage,
        value: cents ? formatCents(cents) : null,
        valueCents: cents,
        ownerId: o.owner_id,
        ownerInitials: o.owner ? initials(o.owner.full_name) : null,
        inStage: age(o.stage_entered_at, now),
        next,
        insurance: o.is_insurance_claim,
        phone: o.customer.phone,
        email: o.customer.email,
        hasProperty: Boolean(o.property_id),
        workType: o.work_type,
        sentEstimates: o.estimates
          .filter((e) => e.status === "sent" || e.status === "viewed")
          .map((e) => ({ id: e.id, label: `E-${e.estimate_number}${e.version > 1 ? `-v${e.version}` : ""}`, total: formatCents(e.total_cents) })),
        _search: `${name} ${o.title} ${o.property?.address_line1 ?? ""}`.toLowerCase(),
      };
    })
    .filter((d) => !q || d._search.includes(q))
    .map(({ _search, ...deal }) => (void _search, deal));

  return deals;
}
