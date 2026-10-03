import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

/** Creates a lead through the form and returns the customer's name. */
async function createLead(page: Page, options: { workType?: string; address?: boolean } = {}) {
  const n = unique();
  const name = `Kan Ban${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Kan");
  await page.getByLabel("Last name").fill(`Ban${n}`);
  await page.getByLabel("Phone").fill(`312555${n.slice(-4)}`);
  if (options.address !== false) {
    await page.getByLabel("Street address").fill(`${n} Board St`);
    await page.getByLabel("ZIP").fill("62701");
  }
  if (options.workType) await page.getByLabel("Type of work").selectOption(options.workType);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

/** Drags a card to a column using real pointer events (dnd-kit needs intermediate moves). */
async function drag(page: Page, cardName: string, columnName: string) {
  const card = page.getByLabel(`${cardName}, drag to move`);
  const column = page.getByRole("region", { name: columnName, exact: true });
  const from = (await card.boundingBox())!;
  const to = (await column.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 140, { steps: 12 });
  await page.mouse.up();
}

test.describe("pipeline", () => {
  test("drag between columns persists; a blocked move asks only for what is missing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "drag and drop is desktop only");
    await signIn(page, "sales@test.local");
    const name = await createLead(page); // no work type
    await page.goto(`/pipeline?owner=all&q=${encodeURIComponent(name)}`);

    const column = (title: string) => page.getByRole("region", { name: title, exact: true });
    await expect(column("New Lead").getByText(name)).toBeVisible();

    await drag(page, name, "Contacted");
    await expect(column("Contacted").getByText(name)).toBeVisible();
    await page.reload();
    await expect(column("Contacted").getByText(name)).toBeVisible();

    // Qualified needs a work type: the card goes back and the gate dialog asks for just that.
    await drag(page, name, "Qualified");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Before moving to Qualified" })).toBeVisible();
    await expect(dialog.getByLabel("Type of work")).toBeVisible();
    await expect(dialog.getByLabel("Owner")).toHaveCount(0);
    await expect(dialog.getByLabel("Street address")).toHaveCount(0);

    await dialog.getByLabel("Type of work").selectOption("gutters");
    await dialog.getByRole("button", { name: "Save and move" }).click();
    await expect(column("Qualified").getByText(name)).toBeVisible();
    await expect(column("Qualified")).toContainText("Gutters");

    // Estimate Sent needs a sent estimate, which cannot be typed into a dialog.
    await drag(page, name, "Estimate Sent");
    await expect(page.getByRole("dialog")).toContainText("needs an estimate that has been sent");
    await page.keyboard.press("Escape");
    await expect(column("Qualified").getByText(name)).toBeVisible();

    // Filters live in the URL.
    expect(page.url()).toContain("owner=all");
  });

  test("won creates a job; lost needs a reason; a lost deal can be reopened", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    const name = await createLead(page, { workType: "roof_repair" });
    await page.getByRole("link", { name: /Roof Repair/ }).click(); // deal card → deal page
    await expect(page.getByRole("heading", { name: /Roof Repair —/ })).toBeVisible();

    await page.getByRole("button", { name: "Lost", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").selectOption("other");
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(dialog.getByLabel(/^Notes/)).toBeFocused(); // browser blocks submit: notes are required for "other"
    await dialog.getByLabel("Reason").selectOption("price");
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("Lost: Price")).toBeVisible();
    await expect(page.getByRole("button", { name: "Won", exact: true })).toHaveCount(0);

    await page.getByLabel("Reopen to stage").selectOption("contacted");
    await expect(page.getByRole("button", { name: "Won", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Won", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Contract amount").fill("12,500");
    await dialog.getByRole("button", { name: "Mark won and create job" }).click();
    await expect(page.getByText(/Deal won\. Job J-\d+ created\./)).toBeVisible();
    const card = page.getByRole("article").first();
    await expect(card).toContainText("$12,500");
    await expect(card).toContainText("Job Pending Schedule");
    await expect(page.getByText("Schedule job J-")).toBeVisible();
    expect(name).toBeTruthy();
  });

  test("deal page: edit details, reassign owner, and the duplicate banner", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    await page.goto("/leads/new");
    await page.getByLabel("First name").fill("Dave");
    await page.getByLabel("Phone").fill("(415) 555-0103"); // David Chen, who already has an open deal
    await page.getByRole("button", { name: "Use this customer" }).click();
    await page.getByLabel("Street address").fill(`${unique()} Second Site Rd`);
    await page.getByLabel("Type of work").selectOption("renovation");
    await page.getByRole("button", { name: "Create lead" }).click();
    await page.getByRole("link", { name: /Renovation/ }).first().click();

    await expect(page.getByText("This may duplicate another open deal")).toBeVisible();
    await page.getByRole("button", { name: "Keep both" }).click();
    await expect(page.getByText("This may duplicate another open deal")).toHaveCount(0);

    await page.getByLabel("Estimated value ($)").fill("18,250.50");
    await page.getByLabel("Insurance claim").check();
    await page.getByLabel("Carrier").fill("State Farm");
    await page.getByRole("button", { name: "Save deal" }).click();
    await expect(page.getByText("Deal saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("article").first()).toContainText("$18,250.50");
    await expect(page.getByLabel("Carrier")).toHaveValue("State Farm");

    await page.getByRole("combobox", { name: "Owner" }).selectOption({ label: "Alex Admin" });
    await expect(page.getByText("Owner changed to Alex Admin")).toBeVisible();
  });

  test("phone: stage chips, counts, and the move sheet (no dragging)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone only");
    await signIn(page, "sales@test.local");
    const name = await createLead(page, { workType: "siding" });
    await page.goto(`/pipeline?owner=all&q=${encodeURIComponent(name)}`);

    const tabs = page.getByRole("tablist", { name: "Stages" });
    await expect(tabs.getByRole("tab", { name: /New Lead 1/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Move" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Contacted" }).click();
    await expect(tabs.getByRole("tab", { name: /Contacted 1/ })).toBeVisible();
    await tabs.getByRole("tab", { name: /Contacted/ }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.getByRole("button", { name: "Move" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Lost" }).click();
    await page.getByRole("dialog").getByLabel("Reason").selectOption("no_response");
    await page.getByRole("dialog").getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("No deals in this stage.")).toBeVisible();
  });
});
