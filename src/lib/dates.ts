import { formatInTimeZone } from "date-fns-tz";

type DateInput = string | Date;

/** "Oct 7" */
export function formatDate(value: DateInput, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "MMM d");
}

/** "Oct 7, 10:00 AM" in the company timezone. */
export function formatDateTime(value: DateInput, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "MMM d, h:mm a");
}

/** Calendar date (yyyy-MM-dd) of an instant in the company timezone. */
export function businessDate(value: DateInput, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd");
}

/** "12 min", "3 hr", "5 days": how long ago, compact, for the leads inbox. */
export function age(value: DateInput, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** "12 min ago" / "in 3 hr" for timelines and due times. */
export function relativeTime(value: DateInput, now: Date = new Date()): string {
  const diff = new Date(value).getTime() - now.getTime();
  const span = age(new Date(now.getTime() - Math.abs(diff)), now);
  if (span === "just now") return span;
  return diff < 0 ? `${span} ago` : `in ${span}`;
}

export type DueState = "overdue" | "today" | "upcoming";

/** Whether a task is overdue, due today, or later, judged in the company timezone. */
export function dueState(dueAt: DateInput, timeZone: string, now: Date = new Date()): DueState {
  if (new Date(dueAt).getTime() < now.getTime()) return "overdue";
  return businessDate(dueAt, timeZone) === businessDate(now, timeZone) ? "today" : "upcoming";
}

/** A datetime-local value ("2026-10-08T09:00") for tomorrow 9:00 in the company timezone. */
export function tomorrowAtNine(timeZone: string, now: Date = new Date()): string {
  return `${formatInTimeZone(new Date(now.getTime() + 86_400_000), timeZone, "yyyy-MM-dd")}T09:00`;
}
