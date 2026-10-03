import { describe, expect, it } from "vitest";
import { companySchema, isValidTimeZone, percentToRate, rateToPercent } from "@/features/settings/schemas";

describe("settings schemas", () => {
  it("converts tax percent to a 5-decimal rate and back", () => {
    expect(percentToRate(8.25)).toBe(0.0825);
    expect(rateToPercent(0.0825)).toBe(8.25);
    expect(percentToRate(0)).toBe(0);
  });

  it("validates time zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("parses the company form, blanking empty optionals", () => {
    const parsed = companySchema.parse({
      company_name: " Piccard Roofing ",
      address_line1: "",
      city: "",
      state: "",
      postal_code: "",
      phone: "",
      email: "",
      license_number: "",
      timezone: "America/Chicago",
      default_tax_rate_percent: "0",
      default_deposit_percent: "30",
      estimate_valid_days: "30",
      estimate_terms: "",
      default_warranty_years: "5",
      default_lead_owner_id: "",
      send_inspection_confirmation: "on",
    });
    expect(parsed.company_name).toBe("Piccard Roofing");
    expect(parsed.address_line1).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.default_lead_owner_id).toBeNull();
    expect(parsed.send_inspection_confirmation).toBe(true);
    expect(parsed.default_deposit_percent).toBe(30);
  });

  it("rejects a deposit over 100", () => {
    const result = companySchema.safeParse({
      company_name: "X", timezone: "America/Chicago", email: "", default_lead_owner_id: "",
      default_tax_rate_percent: "0", default_deposit_percent: "150", estimate_valid_days: "30", default_warranty_years: "5",
    });
    expect(result.success).toBe(false);
  });
});
