import { describe, expect, it } from "vitest";
import { age, businessDate, dueState, formatDateTime, relativeTime } from "@/lib/dates";
import { dealStatus } from "@/lib/deal-status";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { formatPhone, telHref, toE164 } from "@/lib/phone";

describe("phone", () => {
  it("normalizes US numbers in any common format", () => {
    for (const input of ["(415) 555-0101", "415.555.0101", "4155550101", "+1 415 555 0101", "1-415-555-0101"]) {
      expect(toE164(input), input).toBe("+14155550101");
    }
  });
  it("returns null for junk", () => {
    expect(toE164("555")).toBeNull();
    expect(toE164("call me")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
  it("formats for display and tel: links", () => {
    expect(formatPhone("4155550101")).toBe("(415) 555-0101");
    expect(formatPhone("ext 12")).toBe("ext 12");
    expect(telHref("415-555-0101")).toBe("tel:+14155550101");
    expect(telHref(null)).toBeNull();
  });
});

describe("money", () => {
  it("formats cents", () => {
    expect(formatCents(2480000)).toBe("$24,800");
    expect(formatCents(2480050)).toBe("$24,800.50");
    expect(formatCents(2480000, { alwaysCents: true })).toBe("$24,800.00");
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(null)).toBe("—");
  });
  it("parses dollars without float error", () => {
    expect(parseDollarsToCents("$24,800")).toBe(2480000);
    expect(parseDollarsToCents("1200.5")).toBe(120050);
    expect(parseDollarsToCents("19.99")).toBe(1999);
    expect(parseDollarsToCents("0.07")).toBe(7);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
});

describe("dates", () => {
  const tz = "America/New_York";
  it("formats in the company timezone", () => {
    expect(formatDateTime("2026-10-07T14:00:00Z", tz)).toBe("Oct 7, 10:00 AM");
    // 03:30 UTC is still the previous evening in New York
    expect(businessDate("2026-10-08T03:30:00Z", tz)).toBe("2026-10-07");
  });
  it("describes age and relative time", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(age("2026-10-07T11:59:40Z", now)).toBe("just now");
    expect(age("2026-10-07T11:48:00Z", now)).toBe("12 min");
    expect(age("2026-10-07T09:00:00Z", now)).toBe("3 hr");
    expect(age("2026-10-02T12:00:00Z", now)).toBe("5 days");
    expect(relativeTime("2026-10-07T11:48:00Z", now)).toBe("12 min ago");
    expect(relativeTime("2026-10-07T15:00:00Z", now)).toBe("in 3 hr");
  });
  it("classifies due dates by the business day", () => {
    const now = new Date("2026-10-07T16:00:00Z"); // noon in New York
    expect(dueState("2026-10-07T15:00:00Z", tz, now)).toBe("overdue");
    expect(dueState("2026-10-07T22:00:00Z", tz, now)).toBe("today");
    expect(dueState("2026-10-08T03:00:00Z", tz, now)).toBe("today"); // 11pm New York, same business day
    expect(dueState("2026-10-08T14:00:00Z", tz, now)).toBe("upcoming");
  });
});

describe("dealStatus (spec §5.4)", () => {
  it.each([
    [{ stage: "lost", lostReason: "price", jobStatus: "scheduled" }, "Lost — Price"],
    [{ stage: "won", jobStatus: "in_progress", estimateStatus: "accepted" }, "Job In Progress"],
    [{ stage: "won", estimateStatus: "accepted" }, "Accepted"],
    [{ stage: "estimate_sent", estimateStatus: "sent" }, "Awaiting Signature"],
    [{ stage: "estimate_sent", estimateStatus: "viewed" }, "Awaiting Signature"],
    [{ stage: "negotiation", estimateStatus: "declined" }, "Estimate Declined"],
    [{ stage: "negotiation", estimateStatus: "expired" }, "Estimate Expired"],
    [{ stage: "inspection_scheduled", estimateStatus: "draft", hasCompletedInspection: true }, "Estimate In Progress"],
    [{ stage: "inspection_scheduled", hasCompletedInspection: true }, "Estimate Needed"],
    [{ stage: "inspection_scheduled", hasScheduledInspection: true }, "Inspection Scheduled"],
    [{ stage: "qualified" }, "Needs Inspection"],
    [{ stage: "contacted" }, "Qualifying"],
    [{ stage: "new" }, "Needs First Contact"],
  ] as const)("%j → %s", (input, expected) => {
    expect(dealStatus(input)).toBe(expected);
  });
});
