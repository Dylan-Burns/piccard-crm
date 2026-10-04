import {
  ArrowRightLeft, CalendarCheck, CalendarPlus, CalendarX, CheckSquare, CircleDollarSign, Copy, FileText, Hammer, Image as ImageIcon,
  Info, Mail, MessageSquare, Phone, StickyNote, Trophy, UserRound, XCircle, Inbox, type LucideIcon,
} from "lucide-react";
import type { Database } from "@/types/database";

type ActivityType = Database["public"]["Enums"]["activity_type"];

const ICONS: Record<ActivityType, LucideIcon> = {
  lead_received: Inbox,
  duplicate_inquiry: Copy,
  call: Phone,
  email: Mail,
  sms: MessageSquare,
  note_added: StickyNote,
  stage_changed: ArrowRightLeft,
  owner_changed: UserRound,
  deal_won: Trophy,
  deal_lost: XCircle,
  deal_reopened: ArrowRightLeft,
  appointment_scheduled: CalendarPlus,
  appointment_rescheduled: CalendarPlus,
  appointment_completed: CalendarCheck,
  appointment_cancelled: CalendarX,
  files_uploaded: ImageIcon,
  estimate_created: FileText,
  estimate_sent: FileText,
  estimate_viewed: FileText,
  estimate_accepted: FileText,
  estimate_declined: FileText,
  estimate_expired: FileText,
  job_created: Hammer,
  job_status_changed: Hammer,
  invoice_created: CircleDollarSign,
  invoice_synced: CircleDollarSign,
  payment_received: CircleDollarSign,
  task_completed: CheckSquare,
  system: Info,
};

export type TimelineItem = {
  id: string;
  type: ActivityType;
  summary: string;
  /** Free text attached to the entry: a note's body or the notes typed when logging a call. */
  detail?: string | null;
  /** "Shared with crew" marker for notes. */
  shared?: boolean;
  /** Preformatted in the company timezone. */
  when: string;
  /** Who did it, when the summary does not already say. */
  actor?: string | null;
  /** Shown when the customer has more than one deal. */
  dealLabel?: string | null;
};

export function Timeline({ items, emptyText = "Nothing has happened yet." }: { items: TimelineItem[]; emptyText?: string }) {
  if (items.length === 0) return <p className="text-muted-foreground">{emptyText}</p>;
  return (
    <ol className="space-y-0">
      {items.map((item, index) => {
        const Icon = ICONS[item.type];
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < items.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-3.5 w-px bg-border" /> : null}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p>
                {item.summary}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {item.when}
                  {item.actor ? ` · ${item.actor}` : ""}
                </span>
              </p>
              {item.detail ? <p className="mt-1 rounded-md bg-muted px-2.5 py-1.5 whitespace-pre-wrap">{item.detail}</p> : null}
              {item.shared || item.dealLabel ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[item.shared ? "Shared with crew" : null, item.dealLabel].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type Milestone = { label: string; done: boolean };

/** Lead received → Called → Inspection → Photos uploaded → Estimate sent (spec §5.4). */
export function MilestoneStrip({ milestones }: { milestones: Milestone[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" aria-label="Deal progress">
      {milestones.map((m, i) => (
        <li key={m.label} className="flex items-center gap-1">
          <span
            aria-hidden
            className={m.done ? "size-2 rounded-full bg-primary" : "size-2 rounded-full border border-muted-foreground/50"}
          />
          <span className={m.done ? "font-medium" : "text-muted-foreground"}>{m.label}</span>
          <span className="sr-only">{m.done ? "(done)" : "(not yet)"}</span>
          {i < milestones.length - 1 ? <span aria-hidden className="mx-1 text-muted-foreground">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
