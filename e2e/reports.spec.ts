import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

test.describe("dashboard and reports", () => {
  test("admin sees company tiles with the defined labels, needs-attention lists, and the range picker", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the phone layout has its own test");
    await signIn(page, "admin@test.local");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(/^Company · This month$/)).toBeVisible();

    const tiles = page.getByRole("region", { name: "Key numbers" });
    for (const label of ["New leads", "Revenue (sold)", "Conversion rate", "Active jobs", "Upcoming appointments", "Pipeline value"]) {
      await expect(tiles.getByRole("group", { name: label, exact: true })).toBeVisible();
    }
    const revenue = tiles.getByRole("group", { name: "Revenue (sold)" });
    await expect(revenue).toContainText("Invoiced");
    await expect(revenue).toContainText("Outstanding");
    await expect(revenue).toContainText("$");
    await expect(tiles.getByRole("group", { name: "Active jobs" })).toContainText("not affected by the date range");

    const attention = page.getByRole("region", { name: "Needs attention" });
    for (const list of ["Unassigned leads", "Overdue tasks", "Deals with no next step"]) await expect(attention.getByRole("group", { name: list })).toBeVisible();
    await expect(page.getByRole("region", { name: "Next seven days" })).toBeVisible();

    // A period with nothing in it: counts are zero and the rate is a dash, not 0%
    await page.goto("/dashboard?range=custom&from=2015-01-01&to=2015-01-31");
    await expect(tiles.getByRole("group", { name: "New leads" })).toContainText("0");
    await expect(tiles.getByRole("group", { name: "Conversion rate" })).toContainText("—");
    await expect(tiles.getByRole("group", { name: "Conversion rate" })).toContainText("No deals closed in the period");
    await page.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Year to date" }).click();
    await expect(page.getByText(/^Company · Year to date$/)).toBeVisible();
  });

  test("reports: five tables, a range, and a CSV per table; admin only", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "admin@test.local");
    await page.goto("/reports?range=ytd");
    for (const title of ["Leads by source", "Pipeline by stage", "Sold revenue by month", "Sales rep performance", "Lost reasons"]) {
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }
    const reps = page.getByRole("region", { name: "Sales rep performance" });
    await expect(reps.getByRole("columnheader", { name: "Median minutes to first attempt" })).toBeVisible();
    await expect(reps.getByRole("rowheader", { name: "Sam Sales" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Pipeline by stage" }).getByRole("rowheader").first()).toBeVisible();

    const link = page.getByRole("link", { name: "Download Leads by source as CSV" });
    await expect(link).toHaveAttribute("href", "/api/reports/leads-by-source?range=ytd");
    const csv = await page.request.get("/api/reports/leads-by-source?range=ytd");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toMatch(/attachment; filename="leads-by-source-\d{4}-01-01-to-\d{4}-\d{2}-\d{2}\.csv"/);
    expect((await csv.text()).split("\r\n")[0]).toBe("Source,Leads,Won,Lost,Open,Conversion %,Sold ($)");
    expect((await page.request.get("/api/reports/not-a-report")).status()).toBe(404);

    // Sales: own numbers on the dashboard, no reports page, no CSV
    const salesPage = await (await browser.newContext()).newPage();
    await signIn(salesPage, "sales@test.local");
    await salesPage.goto("/dashboard");
    await expect(salesPage.getByText(/^Your numbers · This month$/)).toBeVisible();
    await salesPage.goto("/reports");
    await expect(salesPage).toHaveURL(/\/dashboard/);
    expect((await salesPage.request.get("/api/reports/rep-performance")).status()).toBe(403);

    // Field users have neither
    const fieldPage = await (await browser.newContext()).newPage();
    await signIn(fieldPage, "field@test.local");
    await fieldPage.goto("/dashboard");
    await expect(fieldPage).toHaveURL(/\/today/);
    expect((await fieldPage.request.get("/api/reports/leads-by-source")).status()).toBe(403);
  });

  test("dashboard on a phone: tiles stack and nothing scrolls sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone layout only");
    await signIn(page, "sales@test.local");
    await page.goto("/dashboard");
    await expect(page.getByRole("region", { name: "Key numbers" }).getByRole("group", { name: "Pipeline value" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
