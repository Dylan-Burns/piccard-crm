import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const unique = () => String(Date.now()).slice(-7);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const photos = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `roof-${i + 1}.png`, mimeType: "image/png", buffer: PNG }));

async function createLead(page: Page) {
  const n = unique();
  const name = `Pho Tos${n}`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Pho");
  await page.getByLabel("Last name").fill(`Tos${n}`);
  await page.getByLabel("Phone").fill(`872555${n.slice(-4)}`);
  await page.getByLabel("Street address").fill(`${n} Shingle Ct`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_replacement");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

test.describe("files", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough; the field part uses a phone-sized window");
  });

  test("a field user adds 10 photos from Today; staff see them, one timeline entry, and file a PDF", async ({ page, browser }) => {
    await signIn(page, "sales@test.local");
    const name = await createLead(page);
    const customerUrl = page.url();
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.getByRole("region", { name: "Appointments" }).getByRole("button", { name: "Schedule" }).click();
    const schedule = page.getByRole("dialog");
    await schedule.getByLabel("Who is going").selectOption({ label: "Fran Field" });
    await schedule.getByLabel("Start").fill("15:30");
    await schedule.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Appointment scheduled")).toBeVisible();

    // Field user, on a phone: today's appointment → Add photos
    const fieldPage = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await signIn(fieldPage, "field@test.local");
    const card = fieldPage.getByRole("listitem").filter({ hasText: name });
    await card.getByRole("button", { name: "Add photos" }).click();
    const uploader = fieldPage.getByRole("dialog");
    await expect(uploader.getByLabel("File as")).toContainText("Measurement Report");
    await expect(uploader.getByLabel("File as")).not.toContainText("Estimate"); // field users cannot file priced documents
    await uploader.getByLabel("Choose photos or PDFs").setInputFiles(photos(10));
    await expect(fieldPage.getByText("10 photos uploaded")).toBeVisible({ timeout: 30_000 });
    await expect(uploader).toBeHidden();

    // Staff: photos under the deal, six shown, one timeline entry
    await page.goto(customerUrl);
    const files = page.getByRole("region", { name: "Files" });
    const photoGroup = files.getByRole("region", { name: "Photos" });
    await expect(photoGroup).toContainText("(10)");
    await expect(photoGroup.getByRole("img")).toHaveCount(6);
    await expect(page.getByRole("region", { name: "Timeline" }).getByText("10 photos uploaded")).toHaveCount(1);
    await photoGroup.getByRole("button", { name: "View all 10" }).click();
    await expect(photoGroup.getByRole("img")).toHaveCount(10);

    // Lightbox
    await photoGroup.getByRole("button", { name: /^Open / }).first().click();
    const lightbox = page.getByRole("dialog");
    await expect(lightbox).toContainText("1 of 10");
    await expect(lightbox.getByRole("img")).toHaveJSProperty("complete", true);
    await lightbox.getByRole("button", { name: "Next photo" }).click();
    await expect(lightbox).toContainText("2 of 10");
    await page.keyboard.press("ArrowLeft");
    await expect(lightbox).toContainText("1 of 10");
    await lightbox.getByRole("button", { name: "Close" }).click();

    // A PDF filed as a measurement report shows in that group
    await files.getByRole("button", { name: "Upload" }).click();
    const upload = page.getByRole("dialog");
    await upload.getByLabel("File as").selectOption({ label: "Measurement Report" });
    await upload.getByLabel("Choose photos or PDFs").setInputFiles({ name: "eagleview.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText("1 file uploaded").first()).toBeVisible({ timeout: 30_000 });
    const report = files.getByRole("region", { name: "Measurement Report" });
    await expect(report.getByRole("link", { name: /eagleview\.pdf/ })).toHaveAttribute("target", "_blank");

    // Staff recategorize afterwards
    await report.getByRole("button", { name: "Edit eagleview.pdf" }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel("Category").selectOption({ label: "Insurance" });
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(files.getByRole("region", { name: "Insurance" })).toContainText("eagleview.pdf");
    await expect(edit.getByRole("button", { name: "Delete" })).toHaveCount(0); // sales cannot delete
  });

  test("a failed upload stays listed and Retry finishes it", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, "sales@test.local");
    await createLead(page);
    await page.getByRole("link", { name: /Roof Replacement/ }).click();
    await page.waitForURL(/\/opportunities\//); // the customer page has its own Files panel

    // Connection drops: every attempt to reach storage fails.
    await page.route("**/storage/v1/object/upload/sign/**", (route) => route.abort("internetdisconnected"));
    const files = page.getByRole("region", { name: "Files" });
    await files.getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Choose photos or PDFs").setInputFiles(photos(2));
    await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toHaveCount(2, { timeout: 30_000 });
    await expect(dialog).toContainText("Upload failed");
    await expect(files.getByRole("img")).toHaveCount(0);

    await page.unroute("**/storage/v1/object/upload/sign/**");
    await dialog.getByRole("button", { name: "Retry 2 failed" }).click();
    await expect(page.getByText("2 photos uploaded")).toBeVisible({ timeout: 30_000 });
    await expect(files.getByRole("region", { name: "Photos" }).getByRole("img")).toHaveCount(2);
  });

  test("an admin uploads and removes the company logo", async ({ page }) => {
    await signIn(page, "admin@test.local");
    await page.goto("/settings/company");
    const logo = page.getByRole("region", { name: "Logo" });
    await logo.getByLabel("Choose a logo image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Logo saved")).toBeVisible();
    await expect(logo.getByRole("img", { name: "Company logo" })).toBeVisible();
    await logo.getByRole("button", { name: "Remove", exact: true }).click();
    await logo.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("Logo removed")).toBeVisible();
    await expect(logo.getByRole("img", { name: "Company logo" })).toHaveCount(0);
  });
});
