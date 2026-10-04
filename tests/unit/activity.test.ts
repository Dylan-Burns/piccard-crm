import { describe, expect, it } from "vitest";
import { activityActor, activityText } from "@/lib/activity";

describe("activityText", () => {
  it("says what a stage change moved from and to", () => {
    expect(activityText({ type: "stage_changed", summary: "Stage changed", metadata: { from: "qualified", to: "inspection_scheduled" } })).toBe("Stage changed: Qualified → Inspection Scheduled");
    expect(activityText({ type: "stage_changed", summary: "Stage changed", metadata: { to: "contacted" } })).toBe("Stage changed to Contacted");
    expect(activityText({ type: "stage_changed", summary: "Stage changed", metadata: null })).toBe("Stage changed");
    expect(activityText({ type: "stage_changed", summary: "Stage changed", metadata: { from: "nonsense", to: 7 } })).toBe("Stage changed");
  });

  it("adds the reason to a lost deal and the stage to a reopened one, and never an amount", () => {
    expect(activityText({ type: "deal_lost", summary: "Deal lost", metadata: { reason: "price", from_stage: "estimate_sent" } })).toBe("Deal lost: Price (was Estimate Sent)");
    expect(activityText({ type: "deal_reopened", summary: "Deal reopened", metadata: { to: "contacted" } })).toBe("Deal reopened to Contacted");
    expect(activityText({ type: "deal_won", summary: "Deal won", metadata: { amount_cents: 1_250_000 } })).toBe("Deal won");
  });

  it("leaves other summaries alone", () => {
    expect(activityText({ type: "call", summary: "Called: left voicemail", metadata: {} })).toBe("Called: left voicemail");
  });
});

describe("activityActor", () => {
  it("names the person unless the summary already does or nobody was signed in", () => {
    expect(activityActor({ summary: "Stage changed", actor: { full_name: "Sam Sales" } })).toBe("Sam Sales");
    expect(activityActor({ summary: "Sam Sales added a note", actor: { full_name: "Sam Sales" } })).toBeNull();
    expect(activityActor({ summary: "Lead received from Website", actor: null })).toBeNull();
  });
});
