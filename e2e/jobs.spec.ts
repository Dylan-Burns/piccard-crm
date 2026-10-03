import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function createLead(page: Page) {
  const n = unique();
  const name = `Job Site${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Job");
  await page.getByLabel("Last name").fill(`Site${n}`);
  await page.getByLabel("Phone").fill(`630555${n.slice(-4)}`);
  await page.getByLabel("Street address").fill(`${n} Ridge Rd`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_replacement");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

test.describe("jobs", () => {
  test("won deal → job scheduled by staff → field user starts and completes it without ever seeing a price", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough; the field part uses a phone-sized window");
    test.setTimeout(120_000);
    await signIn(page, "sales@test.local");
    const name = await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.waitForURL(/\/opportunities\//);
    await page.getByRole("button", { name: "Won", exact: true }).click();
    const won = page.getByRole("dialog");
    await won.getByLabel("Contract amount").fill("18,765");
    await won.getByRole("button", { name: "Mark won and create job" }).click();
    await expect(page.getByText(/Deal won\. Job J-\d+ created\./)).toBeVisible();

    // The won deal links to its job; the job is listed as Pending Schedule
    await page.goto("/jobs?status=pending_schedule");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Pending Schedule");
    await row.getByRole("link", { name: /^J-\d+$/ }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/);
    const jobUrl = page.url();
    await expect(page.getByRole("region", { name: "Contract" })).toContainText("$18,765");

    // Staff schedule today with the field user
    await page.getByRole("button", { name: "Schedule job" }).click();
    const schedule = page.getByRole("dialog");
    const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
    await schedule.getByLabel("Start date").fill(today);
    await schedule.getByLabel("End date").fill(today);
    await schedule.getByRole("group", { name: "Work days" }).getByRole("checkbox").first().check();
    await schedule.getByRole("group", { name: "Crew" }).getByLabel("Fran Field").check();
    await schedule.getByRole("button", { name: "Schedule job" }).click();
    await expect(page.getByText("Job scheduled")).toBeVisible();
    await expect(page.getByRole("region", { name: "Crew" })).toContainText("Fran Field");
    await expect(page.getByRole("region", { name: "Schedule" })).toContainText("Fran Field");

    // Field user on a phone. Record every response body to prove no price reaches them.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const fieldPage = await context.newPage();
    const bodies: string[] = [];
    fieldPage.on("response", async (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (!/text|json|x-component/.test(type)) return;
      bodies.push(await response.text().catch(() => ""));
    });
    await signIn(fieldPage, "field@test.local");
    const myJobs = fieldPage.getByRole("region", { name: "My jobs" });
    await myJobs.getByRole("link", { name: new RegExp(`${name.replace("Job Site", "")} Ridge Rd`) }).click(); // job titles carry the address
    await fieldPage.waitForURL(jobUrl);
    await expectNoHorizontalScroll(fieldPage);
    await expect(fieldPage.getByRole("region", { name: "Contract" })).toHaveCount(0);
    await expect(fieldPage.getByRole("region", { name: "Invoices" })).toHaveCount(0);
    await expect(fieldPage.getByRole("region", { name: "Timeline" })).toHaveCount(0);
    await expect(fieldPage.getByRole("button", { name: "Put on hold" })).toHaveCount(0);
    await expect(fieldPage.getByRole("button", { name: "Cancel job" })).toHaveCount(0);

    await fieldPage.getByRole("button", { name: "Start job" }).click();
    await expect(fieldPage.getByText("Job started")).toBeVisible();
    await fieldPage.getByRole("button", { name: "Complete job" }).click();
    const complete = fieldPage.getByRole("dialog", { name: "Complete job" });
    await complete.getByRole("button", { name: "Add completion photos" }).click();
    await fieldPage.getByRole("dialog", { name: "Completion photos" }).getByLabel("Choose photos or PDFs").setInputFiles([
      { name: "done-1.png", mimeType: "image/png", buffer: PNG },
      { name: "done-2.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(fieldPage.getByText("2 photos uploaded")).toBeVisible({ timeout: 30_000 });
    await complete.getByLabel("Completion note").fill("All debris hauled off");
    await complete.getByRole("button", { name: "Mark completed" }).click();
    await expect(fieldPage.getByText("Job completed")).toBeVisible();
    await expect(fieldPage.getByRole("region", { name: "Permit and warranty" })).toContainText("Warranty until");
    await expect(fieldPage.getByRole("region", { name: "Files" }).getByRole("img")).toHaveCount(2);
    await expect(fieldPage.getByRole("region", { name: "Notes" })).toContainText("All debris hauled off");

    // Also browse the list and calendar as the field user, then check everything they were sent.
    await fieldPage.goto("/jobs?status=all");
    await expect(fieldPage.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await fieldPage.goto("/calendar");
    await fieldPage.waitForLoadState("networkidle");
    const sent = bodies.join("\n");
    expect(sent).toContain(name); // the capture works
    expect(sent).not.toMatch(/18,765|1876500|amount_cents|total_cents/);

    // Staff: completed, with the final-invoice task for the admin
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/J-\d+/);
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
    await context.close();
    const adminPage = await (await browser.newContext()).newPage();
    await signIn(adminPage, "admin@test.local");
    await adminPage.goto("/tasks");
    await expect(adminPage.getByText("Send final invoice").first()).toBeVisible();
  });
});
