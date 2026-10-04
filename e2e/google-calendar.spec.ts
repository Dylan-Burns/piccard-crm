import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Google itself is exercised with a fake API in tests/rls/google-calendar.test.ts. Here: the settings
// card and the sign-in entry point, in an environment where Google has not been set up.
test.describe("Google Calendar settings", () => {
  test("the card explains what is missing, and the connect route never leaves the app without credentials", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
    await signIn(page, "admin@test.local");
    await page.goto("/settings/integrations");
    const card = page.getByRole("region", { name: "Google Calendar" });
    await expect(card).toContainText("Not connected");
    await expect(card).toContainText("GOOGLE_CLIENT_ID");
    await expect(card.getByLabel("Google redirect URI")).toHaveValue(/\/api\/integrations\/google\/callback$/);
    await expect(card).toContainText("Internal");
    await expect(card).toContainText("No appointments have failed to sync.");
    await expect(page.getByRole("alert").filter({ hasText: "Google Calendar is disconnected" })).toHaveCount(0);

    await page.goto("/api/integrations/google/connect");
    await expect(page).toHaveURL(/\/settings\/integrations\?google=not_configured$/);
    await expect(page.getByRole("status").filter({ hasText: "Google is not set up yet" })).toBeVisible();

    // A forged callback (no state cookie) is refused
    await page.goto("/api/integrations/google/callback?code=abc&state=forged");
    await expect(page).toHaveURL(/google=error$/);

    // Not for sales users
    const salesPage = await (await browser.newContext()).newPage();
    await signIn(salesPage, "sales@test.local");
    await salesPage.goto("/api/integrations/google/connect");
    await expect(salesPage).not.toHaveURL(/accounts\.google\.com/);
    await expect(salesPage).not.toHaveURL(/settings\/integrations/);
  });
});
