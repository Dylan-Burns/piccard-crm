import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

test.describe("leads and customers", () => {
  test("create a lead, log a call, add a shared note, complete a task", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    const n = unique();
    await signIn(page, "sales@test.local");
    await page.goto("/leads");
    await page.getByRole("link", { name: "New lead" }).click();

    await page.getByLabel("First name").fill("Eve");
    await page.getByLabel("Last name").fill(`Tester${n}`);
    await page.getByLabel("Phone").fill(`415555${n.slice(-4)}`);
    await page.getByLabel("Street address").fill(`${n} Example Way`);
    await page.getByLabel("ZIP").fill("62701");
    await page.getByLabel("Type of work").selectOption("roof_repair");
    await page.getByLabel("What do they need?").fill("Shingles blew off in the storm");
    await page.getByRole("button", { name: "Create lead" }).click();

    // Lands on the customer page with the deal card and the first-contact task
    await expect(page.getByRole("heading", { name: `Eve Tester${n}` })).toBeVisible();
    const card = page.getByRole("article").first();
    await expect(card).toContainText("Roof Repair");
    await expect(card).toContainText("Needs First Contact");
    await expect(card).toContainText("Sam Sales"); // sales user owns the lead they entered
    await expect(page.getByText(`Call new lead: Eve Tester${n}`)).toBeVisible();
    await expect(page.getByText(/^Lead received ·/)).toBeVisible();

    // Log a connected call → Contacted, task swaps
    await card.getByRole("button", { name: "Log contact" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Notes (optional)").fill("Wants someone out this week");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(card).toContainText("Contacted");
    await expect(card).toContainText("Qualifying");
    await expect(page.getByText("Qualify and book inspection")).toBeVisible();
    await expect(page.getByText(`Call new lead: Eve Tester${n}`)).toHaveCount(0);
    await expect(page.getByText("Sam Sales called — connected")).toBeVisible();
    await expect(page.getByText("Wants someone out this week")).toBeVisible();

    // Note shared with crew
    const timeline = page.getByRole("region", { name: "Timeline" });
    await timeline.getByLabel("Add a note").fill("Gate code 4321");
    await timeline.getByLabel("Share with crew").check();
    await timeline.getByRole("button", { name: "Add note" }).click();
    await expect(timeline.getByText("Gate code 4321")).toBeVisible();
    await expect(timeline.getByText("Shared with crew")).toBeVisible();

    // Complete the task
    await page.getByRole("button", { name: "Complete: Qualify and book inspection" }).click();
    await expect(page.getByText("Qualify and book inspection", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Task completed: Qualify and book inspection")).toBeVisible();

    // The lead shows in the inbox as Contacted
    await page.goto("/leads");
    await expect(page.getByRole("row", { name: new RegExp(`Eve Tester${n}`) })).toContainText("Contacted");
  });

  test("duplicate panel offers the existing customer and attaches the new deal to them", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    await page.goto("/leads/new");
    await page.getByLabel("First name").fill("Dave");
    await page.getByLabel("Phone").fill("(415) 555-0103"); // David Chen in the seed

    const panel = page.getByRole("complementary", { name: "Possible existing customers" });
    await expect(panel).toContainText("David Chen");
    await expect(panel).toContainText("Same phone");
    await panel.getByRole("button", { name: "Use this customer" }).click();
    await expect(page.getByText("Adding a deal for David Chen")).toBeVisible();

    await page.getByLabel("Street address").fill("88 Birch Ln");
    await page.getByLabel("Type of work").selectOption("siding");
    await page.getByRole("button", { name: "Create lead" }).click();

    await expect(page.getByRole("heading", { name: "David Chen" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "Siding" }).first()).toBeVisible(); // reruns add more
    await expect(page.getByRole("article").filter({ hasText: "Gutters" })).toBeVisible();
  });

  test("customer search matches name, address, and phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    for (const [query, expected] of [["garcia", "Maria Garcia"], ["cedar", "Sarah Johnson"], ["415-555-0105", "Mike O'Brien"], ["john smith", "John Smith"]] as const) {
      await page.goto(`/customers?q=${encodeURIComponent(query)}`);
      await expect(page.getByRole("link", { name: new RegExp(expected) }), query).toBeVisible();
      await expect(page.getByRole("listitem")).toHaveCount(1);
    }
    await page.goto("/customers?q=zzzznotfound");
    await expect(page.getByText("No customers match that search")).toBeVisible();
  });

  test("the benchmark customer screen shows the deal block", async ({ page }) => {
    await signIn(page, "sales@test.local");
    await page.goto("/customers?q=john+smith");
    await page.getByRole("link", { name: /John Smith/ }).click();
    await expect(page.getByRole("heading", { name: "John Smith" })).toBeVisible();
    await expect(page.getByText("123 Main Street, Springfield, IL, 62700")).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: "Roof Replacement" });
    await expect(card).toContainText("Roof Replacement · $24,800");
    await expect(card).toContainText("Status:");
    await expect(card).toContainText("Job Scheduled");
    await expectNoHorizontalScroll(page);
  });

  test("phone layout: tabs switch panels and the quick-action sheet opens", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone only");
    await signIn(page, "sales@test.local");
    await page.goto("/customers?q=garcia");
    await page.getByRole("link", { name: /Maria Garcia/ }).click();

    const call = page.getByRole("link", { name: "Call" });
    await expect(call).toHaveAttribute("href", "tel:+14155550102");
    expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Details" })).toBeHidden();
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByRole("region", { name: "Details" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Timeline" })).toBeHidden();

    await page.getByRole("button", { name: "Quick actions" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Log call" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.keyboard.press("Escape");
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: "Call" }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("field users see only their own tasks and cannot open customers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "field@test.local");
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/today/);
    await page.goto("/tasks");
    await expect(page.getByText("Upload completion photos")).toBeVisible();
    await expect(page.getByRole("link", { name: "Everyone" })).toHaveCount(0);
    await expect(page.getByText("Follow up")).toHaveCount(0);
  });
});
