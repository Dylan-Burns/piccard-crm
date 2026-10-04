import { LOST_REASON_LABELS, STAGE_LABELS } from "@/lib/deal-status";
import type { Database } from "@/types/database";

type ActivityType = Database["public"]["Enums"]["activity_type"];
type Stage = keyof typeof STAGE_LABELS;
type LostReason = keyof typeof LOST_REASON_LABELS;

const stage = (value: unknown) => (typeof value === "string" && value in STAGE_LABELS ? STAGE_LABELS[value as Stage] : null);

/**
 * The line shown for a timeline entry. Stored summaries are deliberately generic ("Stage changed");
 * the specifics live in `metadata`, so they are added here. Never adds money (CLAUDE.md rule 13).
 */
export function activityText(activity: { type: ActivityType; summary: string; metadata: unknown }): string {
  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  switch (activity.type) {
    case "stage_changed": {
      const from = stage(meta.from);
      const to = stage(meta.to);
      if (from && to) return `Stage changed: ${from} → ${to}`;
      return to ? `Stage changed to ${to}` : activity.summary;
    }
    case "deal_reopened": {
      const to = stage(meta.to);
      return to ? `Deal reopened to ${to}` : activity.summary;
    }
    case "deal_lost": {
      const reason = typeof meta.reason === "string" && meta.reason in LOST_REASON_LABELS ? LOST_REASON_LABELS[meta.reason as LostReason] : null;
      const from = stage(meta.from_stage);
      return [reason ? `Deal lost: ${reason}` : activity.summary, from ? `(was ${from})` : null].filter(Boolean).join(" ");
    }
    default:
      return activity.summary;
  }
}

/** "by Sam Sales", unless the summary already names them or nobody was signed in (automation, the customer). */
export function activityActor(activity: { summary: string; actor?: { full_name: string } | null }): string | null {
  const name = activity.actor?.full_name;
  if (!name || activity.summary.includes(name)) return null;
  return name;
}
