import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

async function createLead(page: Page) {
  const n = unique();
  const name = `Esti Mator${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Esti");
  await page.getByLabel("Last name").fill(`Mator${n}`);
  await page.getByLabel("Phone").fill(`708555${n.slice(-4)}`);
  await page.getByLabel("Street address").fill(`${n} Quote Ln`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_replacement");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

test.describe("estimates", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
  });

  test("price book item → estimate with five lines, discount and tax → same totals in the builder, after reload, and a PDF", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const item = `Architectural shingles ${unique()}`;

    // Admin adds a price-book item
    const adminPage = await (await browser.newContext()).newPage();
    await signIn(adminPage, "admin@test.local");
    await adminPage.goto("/settings/price-book");
    const add = adminPage.locator("form").filter({ hasText: "Add an item" });
    await add.getByLabel("Name").fill(item);
    await add.getByLabel("Unit").fill("sq");
    await add.getByLabel("Price ($)").fill("425.00");
    await add.getByRole("button", { name: "Add item" }).click();
    await expect(adminPage.getByText("Item added")).toBeVisible();
    await expect(adminPage.getByRole("listitem").filter({ hasText: item })).toContainText("$425.00 per sq");

    // Sales builds the estimate
    await signIn(page, "sales@test.local");
    await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    await page.getByRole("tab", { name: "Estimates" }).click();
    await page.getByRole("region", { name: "Estimates" }).getByRole("button", { name: "New estimate" }).click();
    await page.waitForURL(/\/estimates\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /Estimate E-\d+/ })).toBeVisible();

    await page.getByRole("button", { name: "From price book" }).click();
    await page.getByPlaceholder("Search the price book…").fill(item);
    await page.getByRole("option", { name: new RegExp(item) }).click();
    await page.getByLabel("Line 1 quantity").fill("28.5");
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("425.00");

    const custom = [
      { name: "Drip edge", quantity: "120", unit: "lf", price: "6.50", taxable: true },
      { name: "Dumpster and haul-off", quantity: "1", unit: "ea", price: "850", taxable: false },
      { name: "Labor: decking repair", quantity: "6.25", unit: "hr", price: "75.00", taxable: false },
      { name: "Pipe boots", quantity: "3", unit: "ea", price: "129.99", taxable: true },
    ];
    for (const [i, line] of custom.entries()) {
      const n = i + 2;
      await page.getByRole("button", { name: "Custom line" }).click();
      await page.getByLabel(`Line ${n} name`).fill(line.name);
      await page.getByLabel(`Line ${n} quantity`).fill(line.quantity);
      await page.getByLabel(`Line ${n} unit`, { exact: true }).fill(line.unit);
      await page.getByLabel(`Line ${n} unit price`).fill(line.price);
      if (!line.taxable) await page.getByLabel(`Line ${n} taxable`).uncheck();
    }
    await page.getByLabel("Discount ($)").first().fill("500");
    await page.getByLabel("Tax rate (%)").first().fill("8.25");

    // Live preview (worked by hand in tests/unit/estimate-totals.test.ts)
    const totals = page.getByRole("complementary", { name: "Totals" });
    const expected = ["$14,601.22", "$500.00", "$1,058.28", "$15,159.50", "$4,547.85"];
    for (const amount of expected) await expect(totals).toContainText(amount);
    await expect(page.getByLabel("Line 1 total")).toHaveText("$12,112.50");

    // Reorder, then save
    await page.getByRole("button", { name: "Move line 5 up" }).click();
    await expect(page.getByLabel("Line 4 name")).toHaveValue("Pipe boots");
    await totals.getByRole("button", { name: "Save estimate" }).click();
    await expect(page.getByText("Estimate saved")).toBeVisible();

    // Stored totals after a reload are identical
    await page.reload();
    for (const amount of expected) await expect(page.getByRole("complementary", { name: "Totals" })).toContainText(amount);
    await expect(page.getByLabel("Line 4 name")).toHaveValue("Pipe boots");
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

    // A later price-book change does not alter this estimate
    const row = adminPage.getByRole("listitem").filter({ hasText: item });
    await row.getByRole("button", { name: `Edit ${item}` }).click();
    // While editing, the name is an input value, so find the row by that input instead of its text.
    const editing = adminPage.getByRole("listitem").filter({ has: adminPage.locator(`input[name="name"][value="${item}"]`) });
    await editing.getByLabel("Price ($)").fill("999.00");
    await editing.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("$999.00 per sq");
    await page.reload();
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("425.00");
    await expect(page.getByRole("complementary", { name: "Totals" })).toContainText("$15,159.50");

    // PDF: staff get a PDF; the deal lists the estimate with the same total
    const estimateId = page.url().split("/").pop()!;
    const pdf = await page.request.get(`/api/estimates/${estimateId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await page.getByRole("link", { name: "Deal" }).click();
    await page.getByRole("tab", { name: "Estimates" }).click();
    const panel = page.getByRole("region", { name: "Estimates" });
    await expect(panel).toContainText("$15,159.50");
    await expect(panel).toContainText("Draft");
    await expect(panel.getByRole("link", { name: /Preview PDF/ })).toHaveAttribute("href", `/api/estimates/${estimateId}/pdf`);

    // Field users cannot fetch the PDF or open the builder
    const fieldPage = await (await browser.newContext()).newPage();
    await signIn(fieldPage, "field@test.local");
    expect((await fieldPage.request.get(`/api/estimates/${estimateId}/pdf`)).status()).toBe(403);
    await fieldPage.goto(page.url().replace(/\/opportunities\/.*/, `/opportunities/x/estimates/${estimateId}`));
    await expect(fieldPage).toHaveURL(/\/today/);
  });

  test("builder on a phone: line cards, pinned totals, no sideways scroll; voiding makes it read-only", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "sales@test.local");
    await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    await page.getByRole("tab", { name: "Estimates" }).click();
    await page.getByRole("region", { name: "Estimates" }).getByRole("button", { name: "New estimate" }).click();
    await page.waitForURL(/\/estimates\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Custom line" }).click();
    await page.getByLabel("Line 1 name").fill("Roof repair");
    await page.getByLabel("Line 1 unit price").fill("1200");
    const totals = page.getByRole("complementary", { name: "Totals" });
    await expect(totals).toContainText("$1,200.00");
    await expect(totals).toBeInViewport();
    await expectNoHorizontalScroll(page);
    await totals.getByRole("button", { name: "Save estimate" }).click();
    await expect(page.getByText("Estimate saved")).toBeVisible();

    // Typing straight after a save is kept, and an invalid line is reported, not saved
    await page.getByLabel("Line 1 quantity").fill("0");
    await expect(page.getByLabel("Line 1 quantity")).toHaveValue("0");
    await totals.getByRole("button", { name: "Save estimate" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Line 1 needs" })).toBeVisible();

    // Voiding makes it read-only
    await totals.getByRole("button", { name: "Void estimate" }).click();
    await totals.getByRole("button", { name: "Confirm void" }).click();
    await expect(page.getByText("Estimate voided")).toBeVisible();
    await expect(page.getByLabel("Line 1 name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Custom line" })).toHaveCount(0);
    await expect(totals.getByRole("button", { name: /Save/ })).toHaveCount(0);
  });
});
