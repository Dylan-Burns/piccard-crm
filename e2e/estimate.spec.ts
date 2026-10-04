import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

async function createLead(page: Page) {
  const n = unique();
  const name = `Approve Online${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Approve");
  await page.getByLabel("Last name").fill(`Online${n}`);
  await page.getByLabel("Phone").fill(`447555${n.slice(-4)}`);
  await page.getByLabel("Email").fill(`approve${n}@example.com`);
  await page.getByLabel("Street address").fill(`${n} Accept Ave`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_replacement");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return { name, email: `approve${n}@example.com`, customerUrl: page.url() };
}

test.describe("estimate: send, view, approve", () => {
  test("build and send; a plain fetch leaves it Sent; the customer views and approves on a phone; the deal is won with a job and invoices", async ({ page, browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough; the customer part uses a phone-sized window");
    test.setTimeout(120_000);
    await signIn(page, "sales@test.local");
    const { name, email, customerUrl } = await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const dealUrl = page.url();
    await page.getByRole("tab", { name: "Estimates" }).click();
    await page.getByRole("region", { name: "Estimates" }).getByRole("button", { name: "New estimate" }).click();
    await page.waitForURL(/\/estimates\/[0-9a-f-]{36}$/);

    const totals = page.getByRole("complementary", { name: "Totals" });
    await expect(totals.getByRole("button", { name: "Send to customer" })).toBeDisabled(); // nothing to send yet
    await page.getByRole("button", { name: "Custom line" }).click();
    await page.getByLabel("Line 1 name").fill("Full roof replacement");
    await page.getByLabel("Line 1 unit price").fill("24800");
    await expect(totals).toContainText("Save before sending.");
    await totals.getByRole("button", { name: "Save estimate" }).click();
    await expect(page.getByText("Estimate saved")).toBeVisible();

    // Send (asks once more, showing the address)
    await totals.getByRole("button", { name: "Send to customer" }).click();
    await totals.getByRole("button", { name: `Send to ${email}` }).click();
    await expect(page.getByText(/Estimate sent/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Line 1 name")).toBeDisabled();
    const link = await totals.getByLabel("Customer link").inputValue();
    expect(link).toMatch(/\/e\/[0-9a-f-]{36}$/);
    const publicPath = new URL(link).pathname;

    // The deal moved, and the customer card says what it is waiting for
    await page.goto(customerUrl);
    const card = page.getByRole("article").first();
    await expect(card).toContainText("Estimate Sent");
    await expect(card).toContainText("Awaiting Signature");
    await expect(card).toContainText("$24,800");

    // A plain fetch (what an email scanner does) changes nothing, and is never cached or indexed
    const fetched = await request.get(publicPath);
    expect(fetched.status()).toBe(200);
    // A production build sends `no-store` here (checked by hand, see docs/decisions.md); the dev server
    // these tests run against writes its own `no-cache, must-revalidate` for pages.
    expect(fetched.headers()["cache-control"]).toMatch(/no-store|no-cache/);
    expect(fetched.headers()["x-robots-tag"]).toContain("noindex");
    expect(await fetched.text()).toContain("Full roof replacement");
    await page.goto(dealUrl);
    await page.getByRole("tab", { name: "Estimates" }).click();
    await expect(page.getByRole("region", { name: "Estimates" })).toContainText("Sent");

    // The customer, on a phone, not signed in
    const customer = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await customer.goto(publicPath);
    await expect(customer.getByRole("heading", { name: /Estimate E-\d+/ })).toBeVisible();
    await expect(customer.getByRole("region", { name: "Estimate" })).toContainText("$24,800.00");
    await expect(customer.getByRole("region", { name: "Estimate" })).toContainText("Deposit due on approval (30%)");
    await expectNoHorizontalScroll(customer);
    const pdf = await customer.request.get(`/api/public/estimates/${publicPath.split("/").pop()}/pdf`);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");

    // A real view (the page stayed visible) flips it to Viewed
    await expect.poll(async () => {
      await page.reload();
      await page.getByRole("tab", { name: "Estimates" }).click();
      return page.getByRole("region", { name: "Estimates" }).innerText();
    }, { timeout: 20_000 }).toContain("Viewed");

    // Approve: needs the name and the tick
    const approve = customer.getByRole("region", { name: "Approve or decline" });
    await approve.getByLabel("Your full name").fill(name);
    await approve.getByRole("checkbox").check();
    await approve.getByRole("button", { name: "Approve estimate" }).click();
    await expect(customer.getByRole("status")).toContainText("Estimate approved");
    await expect(customer.getByRole("status")).toContainText("A written contract will follow");
    await expect(customer.getByRole("region", { name: "Approve or decline" })).toHaveCount(0);

    // Staff: the deal is won, the job exists with deposit and final draft invoices
    await page.goto(dealUrl);
    await expect(page.getByRole("region", { name: "Job" })).toContainText(/J-\d+/);
    await page.getByRole("tab", { name: "Invoices" }).click();
    const invoices = page.getByRole("region", { name: "Invoices" });
    await expect(invoices).toContainText("Deposit");
    await expect(invoices).toContainText("$7,440.00");
    await expect(invoices).toContainText("Final");
    await expect(invoices).toContainText("$17,360.00");
    await page.getByRole("group", { name: "Filter history" }).getByRole("button", { name: /^Estimates/ }).click();
    await expect(page.getByRole("region", { name: "History" })).toContainText(/Customer approved estimate E-\d+/);
    await page.goto(customerUrl);
    await expect(page.getByRole("article").first()).toContainText("Won");
  });

  test("an unknown or voided link says the estimate is no longer valid; the nightly job needs its secret", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await page.goto("/e/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "This estimate is no longer valid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve estimate" })).toHaveCount(0);
    await page.goto("/e/not-a-token");
    await expect(page.getByRole("heading", { name: "This estimate is no longer valid" })).toBeVisible();
    expect((await request.get("/api/public/estimates/00000000-0000-4000-8000-000000000000/pdf")).status()).toBe(404);
    const view = await request.post("/api/public/estimates/00000000-0000-4000-8000-000000000000/view");
    expect(view.status()).toBe(200);
    expect(view.headers()["cache-control"]).toBe("no-store");
    expect(view.headers()["x-robots-tag"]).toBe("noindex");
    expect((await request.get("/api/cron/nightly")).status()).toBe(401);
  });
});
