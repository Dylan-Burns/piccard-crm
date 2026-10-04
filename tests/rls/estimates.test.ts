import { inflateSync } from "node:zlib";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_DENIED, serviceClient, signInAs, type Client } from "./helpers";
import { loadEstimateDocumentData } from "@/features/estimates/pdf/data";
import { EstimateDocument } from "@/features/estimates/pdf/EstimateDocument";
import { computeTotals } from "@/features/estimates/totals";
import { TOTALS_FIXTURES } from "@/features/estimates/totals.fixtures";
import { formatCents } from "@/lib/money";
import type { Json } from "@/types/database";

type Result = { ok: boolean; code?: string; estimate_id?: string; already?: boolean; total_cents?: number };
let admin: Client, sales: Client, field: Client;
let salesId: string;
const service = serviceClient();
const customers: string[] = [];
let seq = 0;

async function newDeal() {
  seq += 1;
  const n = String(Date.now()).slice(-6) + String(seq).padStart(2, "0");
  const { data } = await service.rpc("create_lead", {
    p: { channel: "website", first_name: "Esti", last_name: `Mate${n}`, phone: `558${n}`, phone_e164: `+1708${n}`, email: `esti${n}@example.com`, address_line1: `${seq} Quote Ln`, city: "Springfield", postal_code: "62701", work_type: "roof_replacement", owner_id: salesId } as Json,
  });
  const r = data as { opportunity_id: string; customer_id: string };
  customers.push(r.customer_id);
  return r.opportunity_id;
}
const create = async (client: Client, opportunityId: string, title?: string) => {
  const { data, error } = await client.rpc("create_estimate", { p_opportunity_id: opportunityId, p_title: title });
  if (error) throw new Error(error.message);
  return data as Result;
};
const toLines = (lines: { quantity: number; unitPriceCents: number; isTaxable: boolean }[]) =>
  lines.map((l, i) => ({ name: `Line ${i + 1}`, description: i === 0 ? "First" : "", quantity: l.quantity.toFixed(2), unit: "sq", unit_price_cents: l.unitPriceCents, is_taxable: l.isTaxable }));
const saveLines = (client: Client, estimateId: string, lines: unknown) => client.rpc("save_estimate_lines", { p_estimate_id: estimateId, p_lines: lines as Json });
const estimate = async (id: string) => (await service.from("estimates").select("*").eq("id", id).single()).data!;

/** Text drawn in a PDF that uses the built-in fonts: inflate each stream and decode the hex strings. */
function pdfText(pdf: Buffer): string {
  const text: string[] = [];
  const binary = pdf.toString("latin1");
  for (const match of binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const run of content.matchAll(/\[((?:<[0-9a-fA-F]*>|[^\]])*)\]\s*TJ/g)) {
      text.push([...run[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, "hex").toString("latin1")).join(""));
    }
  }
  return text.join("\n");
}

beforeAll(async () => {
  ({ client: admin } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field } = await signInAs("field@test.local"));
});

afterAll(async () => {
  for (const id of customers) {
    await service.from("opportunities").delete().eq("customer_id", id);
    await service.from("customers").delete().eq("id", id);
  }
  await service.from("price_book_items").delete().like("name", "Test item %");
});

describe("create_estimate", () => {
  it("copies tax rate, deposit, terms, and validity from settings and logs one activity", async () => {
    const dealId = await newDeal();
    const { data: before } = await service.from("company_settings").select("default_tax_rate, default_deposit_percent, estimate_terms, estimate_valid_days, timezone").single();
    await service.from("company_settings").update({ default_tax_rate: 0.0825, default_deposit_percent: 25, estimate_terms: "Net on completion.", estimate_valid_days: 14 }).eq("id", true);
    try {
      const created = await create(sales, dealId);
      expect(created.ok).toBe(true);
      const e = await estimate(created.estimate_id!);
      const { data: deal } = await service.from("opportunities").select("title").eq("id", dealId).single();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: before!.timezone }).format(new Date());
      const validUntil = new Date(`${today}T00:00:00Z`);
      validUntil.setUTCDate(validUntil.getUTCDate() + 14);
      expect(e).toMatchObject({ status: "draft", version: 1, title: deal!.title, terms: "Net on completion.", deposit_percent: 25, created_by: salesId, total_cents: 0, valid_until: validUntil.toISOString().slice(0, 10) });
      expect(Number(e.tax_rate)).toBe(0.0825);

      // Later settings changes do not touch it
      await service.from("company_settings").update({ default_tax_rate: 0.05, estimate_terms: "Changed" }).eq("id", true);
      expect(await estimate(created.estimate_id!)).toMatchObject({ terms: "Net on completion." });

      const { data: acts } = await service.from("activities").select("summary").eq("opportunity_id", dealId).eq("type", "estimate_created");
      expect(acts).toHaveLength(1);
      expect(acts![0]!.summary).toMatch(/^Estimate E-\d+ created$/);
      expect((await create(sales, dealId, "  Option B  ")).ok).toBe(true);
      const { data: all } = await service.from("estimates").select("title, estimate_number").eq("opportunity_id", dealId).order("estimate_number");
      expect(all!.map((x) => x.title)).toEqual([deal!.title, "Option B"]);
      expect(all![1]!.estimate_number).toBeGreaterThan(all![0]!.estimate_number);
    } finally {
      await service.from("company_settings").update({ default_tax_rate: before!.default_tax_rate, default_deposit_percent: before!.default_deposit_percent, estimate_terms: before!.estimate_terms, estimate_valid_days: before!.estimate_valid_days }).eq("id", true);
    }
  });

  it("is denied to field users and refused on a closed deal", async () => {
    const dealId = await newDeal();
    expect((await field.rpc("create_estimate", { p_opportunity_id: dealId })).error?.code).toBe(PERMISSION_DENIED);
    await sales.rpc("mark_opportunity_lost", { p_opportunity_id: dealId, p_reason: "price" });
    expect(await create(sales, dealId)).toMatchObject({ ok: false, code: "deal_closed" });
    expect((await service.from("estimates").select("id").eq("opportunity_id", dealId)).data).toEqual([]);
  });
});

describe("totals: the database trigger and the TypeScript preview agree", () => {
  it.each(TOTALS_FIXTURES)("$name", async ({ input }) => {
    const dealId = await newDeal();
    const { estimate_id } = await create(sales, dealId);
    const { error } = await sales.from("estimates").update({ discount_cents: input.discountCents, tax_rate: input.taxRate, deposit_percent: input.depositPercent }).eq("id", estimate_id!);
    expect(error).toBeNull();
    const saved = await saveLines(sales, estimate_id!, toLines(input.lines));
    expect(saved.error).toBeNull();

    const expected = computeTotals(input);
    const row = await estimate(estimate_id!);
    expect({ subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents, depositCents: row.deposit_cents }).toEqual({
      subtotalCents: expected.subtotalCents, taxCents: expected.taxCents, totalCents: expected.totalCents, depositCents: expected.depositCents,
    });
    expect(saved.data).toMatchObject({ ok: true, total_cents: expected.totalCents });
  });
});

describe("save_estimate_lines", () => {
  it("replaces the lines in order, validates them, and is staff only", async () => {
    const dealId = await newDeal();
    const { estimate_id } = await create(sales, dealId);
    const lines = toLines([{ quantity: 2, unitPriceCents: 1000, isTaxable: true }, { quantity: 1, unitPriceCents: 500, isTaxable: false }]);
    expect((await saveLines(sales, estimate_id!, lines)).data).toMatchObject({ ok: true, total_cents: 2500 });
    expect((await saveLines(sales, estimate_id!, [lines[1], lines[0], { name: "Third", quantity: "3", unit_price_cents: 100 }])).data).toMatchObject({ ok: true, total_cents: 2800 });
    const { data: stored } = await service.from("estimate_line_items").select("name, sort_order, unit, is_taxable, total_cents").eq("estimate_id", estimate_id!).order("sort_order");
    expect(stored).toEqual([
      { name: "Line 2", sort_order: 0, unit: "sq", is_taxable: false, total_cents: 500 },
      { name: "Line 1", sort_order: 1, unit: "sq", is_taxable: true, total_cents: 2000 },
      { name: "Third", sort_order: 2, unit: "ea", is_taxable: true, total_cents: 300 },
    ]);

    for (const bad of [[{ name: "", quantity: "1", unit_price_cents: 1 }], [{ name: "x", quantity: "0", unit_price_cents: 1 }], [{ name: "x", quantity: "1.999", unit_price_cents: 1 }], [{ name: "x", quantity: "1", unit_price_cents: -5 }], [{ name: "x", quantity: "1", unit_price_cents: "1; drop" }], { not: "an array" }]) {
      expect((await saveLines(sales, estimate_id!, bad)).data).toMatchObject({ ok: false, code: "invalid" });
    }
    expect((await service.from("estimate_line_items").select("id").eq("estimate_id", estimate_id!)).data).toHaveLength(3); // a refused save changes nothing

    expect((await saveLines(field, estimate_id!, lines)).error?.code).toBe(PERMISSION_DENIED);
    // Lines cannot be written around the RPC, and field users cannot read estimates at all
    expect((await sales.from("estimate_line_items").insert({ estimate_id: estimate_id!, name: "Sneaky", unit_price_cents: 1 })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.from("estimates").update({ total_cents: 1 }).eq("id", estimate_id!)).error?.code).toBe(PERMISSION_DENIED);
    expect((await field.from("estimates").select("id").eq("id", estimate_id!)).data ?? []).toEqual([]);
    expect((await field.from("estimate_line_items").select("id").eq("estimate_id", estimate_id!)).data ?? []).toEqual([]);
    expect((await field.from("price_book_items").select("id")).data ?? []).toEqual([]);
  });

  it("only a draft can be edited, and changing a price-book price does not change an estimate", async () => {
    const { data: item, error } = await admin.from("price_book_items").insert({ name: `Test item ${Date.now()}`, unit: "sq", unit_price_cents: 42_500 }).select("id, name, unit, unit_price_cents, is_taxable").single();
    expect(error).toBeNull();
    expect((await sales.from("price_book_items").update({ unit_price_cents: 1 }).eq("id", item!.id).select("id")).data ?? []).toEqual([]); // sales read only

    const dealId = await newDeal();
    const { estimate_id } = await create(sales, dealId);
    await saveLines(sales, estimate_id!, [{ name: item!.name, quantity: "10", unit: item!.unit, unit_price_cents: item!.unit_price_cents, is_taxable: item!.is_taxable }]);
    await admin.from("price_book_items").update({ unit_price_cents: 99_900 }).eq("id", item!.id);
    expect(await estimate(estimate_id!)).toMatchObject({ subtotal_cents: 425_000 });

    await service.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimate_id!);
    expect((await saveLines(sales, estimate_id!, [])).data).toMatchObject({ ok: false, code: "locked" });
    expect((await sales.from("estimates").update({ title: "Changed" }).eq("id", estimate_id!)).error?.hint).toBe("estimate_locked");
    expect(await estimate(estimate_id!)).toMatchObject({ subtotal_cents: 425_000 });
  });
});

describe("void_estimate", () => {
  it("voids a draft or sent estimate, not an accepted one, and is staff only", async () => {
    const dealId = await newDeal();
    const { estimate_id } = await create(sales, dealId);
    expect((await field.rpc("void_estimate", { p_estimate_id: estimate_id! })).error?.code).toBe(PERMISSION_DENIED);
    expect((await sales.rpc("void_estimate", { p_estimate_id: estimate_id! })).data).toEqual({ ok: true });
    expect((await estimate(estimate_id!)).status).toBe("void");
    expect((await sales.rpc("void_estimate", { p_estimate_id: estimate_id! })).data).toEqual({ ok: true, already: true });

    const second = await create(sales, dealId);
    await service.from("estimates").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", second.estimate_id!);
    expect((await sales.rpc("void_estimate", { p_estimate_id: second.estimate_id! })).data).toMatchObject({ ok: false, code: "invalid_status" });
  });
});

describe("PDF", () => {
  it("shows the stored totals, lines, customer, property, license, terms, and signature block", async () => {
    const fixture = TOTALS_FIXTURES.find((f) => f.name.startsWith("five lines"))!;
    const dealId = await newDeal();
    const { estimate_id } = await create(sales, dealId, "Full roof replacement");
    await sales.from("estimates").update({ discount_cents: fixture.input.discountCents, tax_rate: fixture.input.taxRate, deposit_percent: fixture.input.depositPercent, terms: "Balance due on completion.", scope_notes: "Tear off and replace." }).eq("id", estimate_id!);
    await saveLines(sales, estimate_id!, toLines(fixture.input.lines));
    const { data: settings } = await service.from("company_settings").select("license_number").single();
    await service.from("company_settings").update({ license_number: "RC-123456" }).eq("id", true);

    try {
      const data = await loadEstimateDocumentData(sales, estimate_id!);
      expect(data).not.toBeNull();
      const pdf = await renderToBuffer(createElement(EstimateDocument, { data: data! }) as never);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      // Text runs come out with arbitrary spacing, so compare with all whitespace removed.
      const squash = (value: string) => value.replace(/\s+/g, "");
      const text = squash(pdfText(pdf));

      const row = await estimate(estimate_id!);
      const money = (cents: number) => formatCents(cents, { alwaysCents: true });
      // The same numbers in the stored row, the TypeScript preview, and the PDF
      const preview = computeTotals(fixture.input);
      expect({ subtotal: row.subtotal_cents, tax: row.tax_cents, total: row.total_cents, deposit: row.deposit_cents }).toEqual({ subtotal: preview.subtotalCents, tax: preview.taxCents, total: preview.totalCents, deposit: preview.depositCents });
      for (const cents of [row.subtotal_cents, row.discount_cents, row.tax_cents, row.total_cents, row.deposit_cents]) expect(text).toContain(squash(money(cents)));
      for (const expected of ["Estimate", `E-${row.estimate_number}`, "Full roof replacement", "Tear off and replace.", "Line 1", "Line 5", "28.50", "Tax (8.25%)", "Deposit due on acceptance (30%)", "Balance due on completion.", "License RC-123456", "Customer signature", "Quote Ln", "Esti Mate"]) {
        expect(text, expected).toContain(squash(expected));
      }
      expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1); // fits one letter page

      // Field users get nothing to render
      expect(await loadEstimateDocumentData(field, estimate_id!)).toBeNull();
    } finally {
      await service.from("company_settings").update({ license_number: settings!.license_number }).eq("id", true);
    }
  });
});
