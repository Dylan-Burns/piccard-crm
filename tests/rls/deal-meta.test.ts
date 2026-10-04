import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/types/database";
import { serviceClient, signInAs, type Client } from "./helpers";

// Labels and expected close date (0015): descriptive deal columns that staff edit directly.
let sales: Client, field: Client;
let salesId: string, dealId: string, customerId: string;
const service = serviceClient();

beforeAll(async () => {
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
  const n = String(Date.now()).slice(-8);
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Label", last_name: `Test${n}`, phone: `559${n}`, phone_e164: `+1331${n}`, address_line1: "1 Tag St", postal_code: "62701", work_type: "roof_repair", owner_id: salesId } as Json,
  });
  ({ opportunity_id: dealId, customer_id: customerId } = data as { opportunity_id: string; customer_id: string });
});

afterAll(async () => {
  await service.from("opportunities").delete().eq("customer_id", customerId);
  await service.from("customers").delete().eq("id", customerId);
});

const stored = async () => (await service.from("opportunities").select("labels, expected_close_on").eq("id", dealId).single()).data!;

describe("deal labels and expected close date", () => {
  it("start empty; staff can set and clear them", async () => {
    expect(await stored()).toEqual({ labels: [], expected_close_on: null });
    const set = await sales.from("opportunities").update({ labels: ["Insurance", "Hot lead"], expected_close_on: "2027-03-15" }).eq("id", dealId).select("id");
    expect(set.error).toBeNull();
    expect(set.data).toHaveLength(1);
    expect(await stored()).toEqual({ labels: ["Insurance", "Hot lead"], expected_close_on: "2027-03-15" });
    expect((await sales.from("opportunities").update({ labels: [], expected_close_on: null }).eq("id", dealId)).error).toBeNull();
    expect(await stored()).toEqual({ labels: [], expected_close_on: null });
  });

  it("refuses more than 10 labels, blank or untrimmed or long labels, and duplicates", async () => {
    const bad: string[][] = [
      Array.from({ length: 11 }, (_, i) => `L${i}`),
      [""],
      [" padded "],
      ["x".repeat(31)],
      ["Insurance", "insurance"],
    ];
    for (const labels of bad) {
      const { error } = await sales.from("opportunities").update({ labels }).eq("id", dealId);
      expect(error?.code, JSON.stringify(labels)).toBe("23514"); // check_violation
    }
    expect((await stored()).labels).toEqual([]);
  });

  it("field users can neither read nor change them", async () => {
    expect((await field.from("opportunities").select("labels").eq("id", dealId)).data ?? []).toEqual([]);
    const attempt = await field.from("opportunities").update({ labels: ["Sneaky"] }).eq("id", dealId).select("id");
    expect(attempt.data ?? []).toEqual([]);
    expect((await stored()).labels).toEqual([]);
  });

  it("granting these columns did not open the lifecycle columns", async () => {
    expect((await sales.from("opportunities").update({ labels: ["x"], stage: "won" }).eq("id", dealId)).error?.code).toBe("42501");
    expect((await stored()).labels).toEqual([]);
  });
});
