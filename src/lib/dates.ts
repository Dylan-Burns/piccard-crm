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

// ---------------------------------------------------------------------------
// Calendar dates. A "day" is a plain yyyy-MM-dd string in the company timezone; arithmetic on
// days is done in UTC so daylight-saving changes never shift a date.
// ---------------------------------------------------------------------------

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday of the week containing `day`. */
export function startOfWeek(day: string): string {
  return addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** "Mon, Oct 5" for a plain day string. */
export function formatDay(day: string, pattern: "short" | "long" | "month" = "short"): string {
  const d = new Date(`${day}T12:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    pattern === "month"
      ? { month: "long", year: "numeric", timeZone: "UTC" }
      : pattern === "long"
        ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }
        : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(d);
}

/** "10:00 AM" in the company timezone. */
export function formatTime(value: DateInput, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "h:mm a");
}

/** "14:30" (24-hour) in the company timezone, for <input type="time">. */
export function timeInputValue(value: DateInput, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "HH:mm");
}
