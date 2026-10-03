import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

async function createLead(page: Page) {
  const n = unique();
  const name = `Cal Endar${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Cal");
  await page.getByLabel("Last name").fill(`Endar${n}`);
  await page.getByLabel("Phone").fill(`773555${n.slice(-4)}`);
  await page.getByLabel("Email").fill(`cal${n}@example.com`);
  await page.getByLabel("Street address").fill(`${n} Visit Ave`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_replacement");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

test.describe("appointments", () => {
  test("schedule an inspection, see it on the calendar, field user completes it, owner gets the estimate task", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    const name = await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();

    await page.getByRole("region", { name: "Appointments" }).getByRole("button", { name: "Schedule" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Who is going").selectOption({ label: "Fran Field" });
    await dialog.getByLabel("Start").fill("14:30");
    await dialog.getByLabel("Notes (optional)").fill("Check the flashing");
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Appointment scheduled")).toBeVisible();

    // Stage moved, card and panel show it
    await expect(page.getByRole("article").first()).toContainText("Inspection Scheduled");
    await expect(page.getByRole("article").first()).toContainText("2:30 PM");
    await expect(page.getByRole("region", { name: "Appointments" })).toContainText(`Inspection: ${name}`);

    // Calendar (week view)
    await page.goto("/calendar");
    await expect(page.getByRole("button", { name: new RegExp(`2:30pm ${name}`) })).toBeVisible();

    // The field user sees it on Today and completes it
    const fieldPage = await (await browser.newContext()).newPage();
    await signIn(fieldPage, "field@test.local");
    await expect(fieldPage).toHaveURL(/\/today/);
    const card = fieldPage.getByRole("listitem").filter({ hasText: name });
    await expect(card).toContainText("2:30 PM · Inspection");
    await expect(card).toContainText("Check the flashing");
    await expect(card.getByRole("link", { name: "Navigate" })).toHaveAttribute("href", /google\.com\/maps/);
    await card.getByRole("button", { name: "Mark complete" }).click();
    dialog = fieldPage.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reschedule" })).toHaveCount(0); // field cannot reschedule
    await dialog.getByRole("button", { name: "Mark complete" }).click();
    await dialog.getByLabel(/What did you find/).fill("Two layers, soft decking");
    await dialog.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(fieldPage.getByText("Appointment completed")).toBeVisible();
    await expect(card).toContainText("Done");

    // Field users are kept out of sales screens
    for (const path of ["/pipeline", "/leads"]) {
      await fieldPage.goto(path);
      await expect(fieldPage).toHaveURL(/\/today/);
    }

    // Back as sales: the estimate task exists and the card says Estimate Needed
    await page.goto("/tasks");
    await expect(page.getByText("Prepare and send estimate").first()).toBeVisible();
    await page.goto(`/customers?q=${encodeURIComponent(name)}`);
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByRole("article").first()).toContainText("Estimate Needed");
    await expect(page.getByText("Inspection completed")).toBeVisible();
  });

  test("dropping a deal on Inspection Scheduled opens the schedule dialog", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "drag and drop is desktop only");
    await signIn(page, "sales@test.local");
    const name = await createLead(page);
    await page.goto(`/pipeline?owner=all&q=${encodeURIComponent(name)}`);

    const card = page.getByLabel(`${name}, drag to move`);
    const column = page.getByRole("region", { name: "Inspection Scheduled", exact: true });
    const from = (await card.boundingBox())!;
    const to = (await column.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 140, { steps: 12 });
    await page.mouse.up();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Schedule appointment" })).toBeVisible();
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByRole("region", { name: "Inspection Scheduled", exact: true }).getByText(name)).toBeVisible();
  });

  test("calendar on a phone is an agenda with no sideways scroll; cancel sends the deal back", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone only");
    await signIn(page, "sales@test.local");
    const name = await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.getByRole("region", { name: "Appointments" }).getByRole("button", { name: "Schedule" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Appointment scheduled")).toBeVisible();

    await page.goto("/calendar");
    await expectNoHorizontalScroll(page);
    const row = page.getByRole("button", { name: new RegExp(`Inspection: ${name}`) });
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await row.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel appointment" }).click();
    await dialog.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByText("Appointment cancelled")).toBeVisible();

    await page.goto(`/pipeline?owner=all&q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("tab", { name: /Qualified 1/ })).toBeVisible();
  });

  test("digest cron requires its secret", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "API test runs once");
    expect((await request.get("/api/cron/task-digest")).status()).toBe(401);
    const ok = await request.get("/api/cron/task-digest", { headers: { authorization: "Bearer local-test-cron-secret-0123456789" } });
    expect(await ok.json()).toMatchObject({ ok: true });
  });
});
