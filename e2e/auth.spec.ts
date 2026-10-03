import { expect, test } from "@playwright/test";
import { errorBanner, expectNoHorizontalScroll, latestEmailLink, PASSWORD, signIn } from "./helpers";

test("unauthenticated visit redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("open-redirect attempts stay on the site", async ({ page }) => {
  await page.goto("/login?next=/%5Cevil.com");
  await page.getByLabel("Email").fill("sales@test.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3000\/dashboard/);
});

test("a bad confirm link shows an error and never leaves the site", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=x&type=invite&next=//evil.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(errorBanner(page)).toContainText("invalid or has expired");
  await expect(page).toHaveURL(/localhost:3000\/auth\/confirm/);
});

test("opening a link does not sign anyone in until Continue is pressed", async ({ page, request }) => {
  // A scanner-style GET must not consume the token or create a session.
  const response = await request.get("/auth/confirm?token_hash=x&type=recovery&next=/set-password");
  expect(response.status()).toBe(200);
  expect(response.headers()["set-cookie"] ?? "").not.toContain("auth-token");
  await page.goto("/auth/confirm?token_hash=x&type=recovery&next=/set-password");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("wrong password shows an error", async ({ page }) => {
  await signIn(page, "sales@test.local", "wrong-password", false);
  await expect(errorBanner(page)).toContainText("Incorrect email or password");
});

test("sales lands on dashboard and sees no admin navigation", async ({ page }, testInfo) => {
  await signIn(page, "sales@test.local");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  if (testInfo.project.name === "desktop") {
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    await expect(nav.getByRole("link", { name: "Pipeline" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
  } else {
    const tabs = page.getByRole("navigation", { name: "Main" }).last();
    await expect(tabs.getByRole("link", { name: "Leads" })).toBeVisible();
    const box = await tabs.getByRole("link", { name: "Leads" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await page.goto("/reports");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("field lands on today and cannot open staff pages", async ({ page }) => {
  await signIn(page, "field@test.local");
  await expect(page).toHaveURL(/\/today/);
  for (const path of ["/pipeline", "/leads", "/settings/users", "/dashboard"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/today/);
  }
  await expectNoHorizontalScroll(page);
});

test("admin invites a user, who sets a password, and can then be deactivated", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  const email = `invite-${Date.now()}@test.local`;

  await signIn(page, "admin@test.local");
  await page.goto("/settings/users");
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Ivy Invited");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Role").selectOption("field");
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  const link = await dialog.getByLabel("Invitation link").inputValue();
  expect(link).toContain("localhost:3000/auth/confirm");
  await dialog.getByRole("button", { name: "Done" }).click();

  // The invited user opens the link in a separate browser session.
  const invited = await (await browser.newContext()).newPage();
  await invited.goto(link);
  await invited.getByRole("button", { name: "Continue" }).click();
  await expect(invited).toHaveURL(/\/set-password/);
  await invited.getByLabel("New password").fill("NewPassword456!");
  await invited.getByLabel("Confirm password").fill("NewPassword456!");
  await invited.getByRole("button", { name: "Save password" }).click();
  await expect(invited).toHaveURL(/\/today/);

  // Admin deactivates them.
  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: email });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByText("Deactivated")).toBeVisible();

  // Their existing session is ended on the next request, and they cannot sign back in.
  await invited.goto("/today");
  await expect(invited).toHaveURL(/\/login/);
  await signIn(invited, email, "NewPassword456!", false);
  await expect(errorBanner(invited)).toContainText("deactivated");
});

test("forgot password emails a working reset link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill("reset@test.local");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("reset link is on its way");

  await page.goto(await latestEmailLink("reset@test.local"));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/set-password/);
  // Unique per run: Supabase rejects a reset to the current password.
  const newPassword = `Reset-${Date.now()}!a`;
  await page.getByLabel("New password").fill(newPassword);
  await page.getByLabel("Confirm password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/today/);
});

test("changing a password needs the current one, and sign-out works", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(page, "sales@test.local");

  // A password-based session cannot use the invite/reset form.
  await page.goto("/set-password");
  await page.getByLabel("New password").fill("Whatever123!");
  await page.getByLabel("Confirm password").fill("Whatever123!");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(errorBanner(page)).toContainText("Settings");

  await page.goto("/settings/profile");
  await page.getByLabel("Current password").fill("not-my-password");
  await page.getByLabel("New password", { exact: true }).fill("Whatever123!");
  await page.getByLabel("Confirm new password").fill("Whatever123!");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Current password is incorrect")).toBeVisible();

  // GET /auth/signout must not log an active user out.
  await page.goto("/auth/signout");
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("button", { name: "Account menu" }).first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("admin can save company settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(page, "admin@test.local");
  await page.goto("/settings/company");
  await page.getByLabel("Company name").fill("Piccard Roofing");
  await page.getByLabel("Sales tax rate (%)").fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Company settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Company name")).toHaveValue("Piccard Roofing");
});
