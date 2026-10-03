import { describe, expect, it } from "vitest";
import { guessWorkType, normalizeGoogleAdsLead, normalizeWebsiteLead } from "@/features/leads/normalize";
import { parseCsv, toLead } from "../../scripts/import-csv";

describe("normalizeWebsiteLead", () => {
  it("splits a single name, normalizes phone and email, maps the service", () => {
    const result = normalizeWebsiteLead({ name: "Jane Q Homeowner", phone: "(415) 555-0199", email: " Jane@Example.COM ", address: "5 Oak St", zip: "62701", service: "Roof repair", message: "Leak" });
    expect(result).toMatchObject({
      ok: true,
      lead: { channel: "website", first_name: "Jane", last_name: "Q Homeowner", phone_e164: "+14155550199", email: "jane@example.com", address_line1: "5 Oak St", postal_code: "62701", work_type: "roof_repair", source_name: "Website" },
    });
  });
  it("credits paid clicks to Google Ads", () => {
    expect(normalizeWebsiteLead({ name: "A B", phone: "4155550100", gclid: "abc" })).toMatchObject({ lead: { source_name: "Google Ads", gclid: "abc" } });
    expect(normalizeWebsiteLead({ name: "A B", phone: "4155550100", utm_medium: "CPC" })).toMatchObject({ lead: { source_name: "Google Ads" } });
  });
  it("rejects honeypot hits and unreachable leads", () => {
    expect(normalizeWebsiteLead({ name: "Bot", phone: "4155550100", website: "http://spam" })).toEqual({ ok: false, reason: "Honeypot filled" });
    expect(normalizeWebsiteLead({ name: "No Contact" })).toEqual({ ok: false, reason: "No phone or email" });
    expect(normalizeWebsiteLead({ phone: "4155550100" })).toEqual({ ok: false, reason: "No name" });
    expect(normalizeWebsiteLead({ name: "X", email: "not-an-email" })).toEqual({ ok: false, reason: "No phone or email" });
  });
  it("ignores non-string values instead of throwing", () => {
    expect(normalizeWebsiteLead({ name: { evil: true }, phone: ["x"], email: null } as never)).toMatchObject({ ok: false });
  });
});

describe("normalizeGoogleAdsLead", () => {
  const base = { lead_id: "L1", form_id: 7, campaign_id: 99, gcl_id: "g123" };
  it("reads FULL_NAME", () => {
    const result = normalizeGoogleAdsLead({ ...base, user_column_data: [{ column_id: "FULL_NAME", string_value: "Sam Roofer" }, { column_id: "PHONE_NUMBER", string_value: "+14155550123" }, { column_id: "POSTAL_CODE", string_value: "62704" }] });
    expect(result).toMatchObject({ ok: true, lead: { channel: "google_ads", first_name: "Sam", last_name: "Roofer", phone_e164: "+14155550123", postal_code: "62704", source_name: "Google Ads", source_detail: "form 7 / campaign 99", gclid: "g123" } });
  });
  it("reads FIRST_NAME and LAST_NAME", () => {
    const result = normalizeGoogleAdsLead({ ...base, user_column_data: [{ column_id: "FIRST_NAME", string_value: "Ana" }, { column_id: "LAST_NAME", string_value: "Lopez" }, { column_id: "EMAIL", string_value: "ANA@example.com" }] });
    expect(result).toMatchObject({ ok: true, lead: { first_name: "Ana", last_name: "Lopez", email: "ana@example.com" } });
  });
  it("rejects Google's test leads", () => {
    expect(normalizeGoogleAdsLead({ ...base, is_test: true, user_column_data: [] })).toEqual({ ok: false, reason: "Google Ads test lead" });
  });
});

describe("guessWorkType", () => {
  it.each([["Roof repair", "roof_repair"], ["New roof", "roof_replacement"], ["Full replacement", "roof_replacement"], ["Gutters", "gutters"], ["vinyl siding", "siding"], ["Kitchen remodel", "renovation"], ["roof_replacement", "roof_replacement"], ["", ""], ["Something else", ""]])("%s → %s", (text, expected) => {
    expect(guessWorkType(text)).toBe(expected);
  });
});

describe("CSV import", () => {
  it("parses quoted fields, embedded commas, quotes, and newlines", () => {
    expect(parseCsv('name,notes\r\n"Smith, John","said ""call me""\nafter 5"\nJane,ok\n\n')).toEqual([["name", "notes"], ["Smith, John", 'said "call me"\nafter 5'], ["Jane", "ok"]]);
  });
  it("maps a row and validates stage, owner, and value", () => {
    const owners = new Map([["sam@x.com", "owner-id"]]);
    expect(toLead({ name: "John Smith", phone: "415-555-0101", address: "1 Main St", zip: "62701", service: "Roof repair", stage: "Estimate Sent", owner_email: "Sam@X.com", value: "$4,850" }, owners)).toMatchObject({
      lead: { channel: "import", import_stage: "estimate_sent", first_name: "John", last_name: "Smith", phone_e164: "+14155550101", work_type: "roof_repair", owner_id: "owner-id", estimated_value_cents: 485000 },
    });
    expect(toLead({ name: "X", phone: "1", stage: "won" }, owners)).toMatchObject({ error: expect.stringContaining("not an open stage") });
    expect(toLead({ name: "X", phone: "1", owner_email: "nobody@x.com" }, owners)).toMatchObject({ error: expect.stringContaining("not an active") });
    expect(toLead({ name: "X" }, owners)).toEqual({ error: "no phone or email" });
  });
});
