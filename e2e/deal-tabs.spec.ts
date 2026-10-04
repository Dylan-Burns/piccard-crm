import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);

async function openNewDeal(page: Page) {
  const n = unique();
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Tab");
  await page.getByLabel("Last name").fill(`Bar${n}`);
  await page.getByLabel("Phone").fill(`224555${n.slice(-4)}`);
  await page.getByLabel("Street address").fill(`${n} Panel Way`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_repair");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name: `Tab Bar${n}` })).toBeVisible();
  await page.getByRole("link", { name: /Roof Repair/ }).click();
  await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
}

test.describe("deal page tabs", () => {
  test("each tab holds its own form and filters the history beneath it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the phone layout has its own test");
    await signIn(page, "sales@test.local");
    await openNewDeal(page);

    const tabs = page.getByRole("tablist", { name: "What to add" });
    await expect(tabs.getByRole("tab")).toHaveText(["Activity", "Notes", "Appointments", "Call", "Email", "Files", "Estimates", "Invoices"]);
    await expect(tabs.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    const history = page.getByRole("region", { name: "History" });
    const chips = history.getByRole("group", { name: "Filter history" });
    await expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await expect(history).toContainText("Lead received");

    // Focus shows the next step
    const focus = page.getByRole("region", { name: "Focus" });
    await expect(focus.getByRole("listitem").first()).toBeVisible();

    // Notes tab: composer on top, only notes below
    await tabs.getByRole("tab", { name: "Notes" }).click();
    await expect(chips.getByRole("button", { name: /^Notes/ })).toHaveAttribute("aria-pressed", "true");
    await expect(history).toContainText("Nothing of this kind yet.");
    await page.getByRole("tabpanel", { name: "Notes" }).getByLabel("Add a note").fill("Gate code 4321");
    await page.getByRole("tabpanel", { name: "Notes" }).getByRole("button", { name: /Add note|Save/ }).click();
    await expect(history).toContainText("Gate code 4321");
    await expect(chips.getByRole("button", { name: "Notes (1)" })).toBeVisible();
    await expect(history).not.toContainText("Lead received");

    // Call tab: the form is inline and fixed to a call
    await tabs.getByRole("tab", { name: "Call" }).click();
    const call = page.getByRole("tabpanel", { name: "Call" });
    await expect(call.getByRole("group", { name: "How" })).toHaveCount(0);
    await call.getByRole("button", { name: "Left voicemail" }).click();
    await call.getByLabel("Notes (optional)").fill("Left a message about Thursday");
    await call.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Contact logged")).toBeVisible();
    await expect(chips.getByRole("button", { name: /^Activities/ })).toHaveAttribute("aria-pressed", "true");
    await expect(history).toContainText("Left a message about Thursday");
    await expect(history).not.toContainText("Gate code 4321");

    // Email tab filters to emails; chips can be changed on their own
    await tabs.getByRole("tab", { name: "Email" }).click();
    await expect(chips.getByRole("button", { name: "Emails (0)" })).toHaveAttribute("aria-pressed", "true");
    await chips.getByRole("button", { name: /^Changelog/ }).click();
    await expect(history).toContainText("Lead received");
    await expect(tabs.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    await chips.getByRole("button", { name: "All" }).click();
    await expect(history).toContainText("Gate code 4321");
    await expect(history).toContainText("Left a message about Thursday");

    // The other tabs hold their sections
    await tabs.getByRole("tab", { name: "Files" }).click();
    await expect(page.getByRole("region", { name: "Files" }).getByRole("button", { name: "Upload" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Estimates" }).click();
    await expect(page.getByRole("region", { name: "Estimates" }).getByRole("button", { name: "New estimate" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByRole("region", { name: "Invoices" })).toContainText("No invoices");
    await tabs.getByRole("tab", { name: "Appointments" }).click();
    await expect(page.getByRole("region", { name: "Appointments" }).getByRole("button", { name: "Schedule" })).toBeVisible();
  });

  test("the sidebar shows the customer, property, overview, and source in sections that fold", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "sales@test.local");
    await openNewDeal(page);

    const customer = page.getByRole("region", { name: "Customer" });
    await expect(customer.getByRole("link", { name: /^Tab Bar\d+$/ })).toHaveAttribute("href", /\/customers\//);
    await expect(customer.getByRole("link", { name: /\(224\) 555-/ })).toHaveAttribute("href", /^tel:/);
    const property = page.getByRole("region", { name: "Property" });
    await expect(property).toContainText("Panel Way");
    await expect(property.getByRole("link", { name: "Navigate" })).toHaveAttribute("href", /google\.com\/maps/);
    const overview = page.getByRole("region", { name: "Overview" });
    await expect(overview).toContainText("Deal age");
    await expect(overview).toContainText("None logged");
    await expect(page.getByRole("region", { name: "Source" })).toContainText("Received");
    await expect(page.getByRole("region", { name: "Job" })).toHaveCount(0); // only once the deal is won

    // Sections fold; Details starts folded and opens to the edit form
    await customer.getByText("Customer", { exact: true }).click();
    await expect(customer.getByRole("link", { name: /^Tab Bar/ })).toBeHidden();
    const details = page.getByRole("region", { name: "Deal details" });
    await expect(details.getByRole("button", { name: "Save deal" })).toBeHidden();
    await details.getByText("Deal details", { exact: true }).click();
    await expect(details.getByRole("button", { name: "Save deal" })).toBeVisible();

    // Labels and the expected close date are edited in place and survive a reload
    const quick = page.getByRole("region", { name: "Labels and close date" });
    await quick.getByLabel("Add a label").fill("Insurance");
    await quick.getByLabel("Add a label").press("Enter");
    await quick.getByLabel("Add a label").fill("Hot lead");
    await quick.getByLabel("Add a label").press("Enter");
    await expect(quick.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveText(["Insurance", "Hot lead"]);
    await quick.getByLabel("Add a label").fill("insurance"); // same label again, different case: ignored
    await quick.getByLabel("Add a label").press("Enter");
    await expect(quick.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveCount(2);
    await quick.getByLabel("Expected close").fill("2027-03-15");
    await quick.getByRole("button", { name: "Remove label Hot lead" }).click();
    await expect(quick.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveText(["Insurance"]);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(quick.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveText(["Insurance"]);
    await expect(quick.getByLabel("Expected close")).toHaveValue("2027-03-15");

    // Logging a call updates the overview
    await page.getByRole("tab", { name: "Call" }).click();
    await page.getByRole("tabpanel", { name: "Call" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Contact logged")).toBeVisible();
    await expect(overview).not.toContainText("None logged");
  });

  test("on a phone the tab bar scrolls sideways inside itself and the page does not", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone layout only");
    await signIn(page, "sales@test.local");
    await openNewDeal(page);
    await expectNoHorizontalScroll(page);
    const tabs = page.getByRole("tablist", { name: "What to add" });
    await tabs.getByRole("tab", { name: "Invoices" }).scrollIntoViewIfNeeded();
    await tabs.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByRole("region", { name: "Invoices" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The working area comes before the deal's details
    const workspace = await page.getByRole("region", { name: "Add to this deal" }).boundingBox();
    const details = await page.getByRole("region", { name: "Deal details" }).boundingBox();
    expect(workspace!.y).toBeLessThan(details!.y);
  });
});
