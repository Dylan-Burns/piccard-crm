import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

loadEnv({ path: ".env.local", quiet: true });
// Used only to put a linked mailbox and two synced messages in place; the providers themselves are
// exercised with fakes in tests/rls/email-linking.test.ts.
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const unique = () => String(Date.now()).slice(-7);

async function openNewDeal(page: Page) {
  const n = unique();
  const email = `inbox${n}@customer.example`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Inbox");
  await page.getByLabel("Last name").fill(`Zero${n}`);
  await page.getByLabel("Phone").fill(`331555${n.slice(-4)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Street address").fill(`${n} Reply Rd`);
  await page.getByLabel("ZIP").fill("62701");
  await page.getByLabel("Type of work").selectOption("roof_repair");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { name: `Inbox Zero${n}` })).toBeVisible();
  await page.getByRole("link", { name: /Roof Repair/ }).click();
  await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
  return { email, dealId: page.url().split("/").pop()! };
}

test.describe("linked email accounts", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one run is enough");
  });

  test("without a linked mailbox: the profile card and the deal's Email tab say what to do; field users have no card", async ({ page, browser }) => {
    await signIn(page, "sales@test.local");
    await page.goto("/settings/profile");
    const card = page.getByRole("region", { name: "Email account" });
    await expect(card).toContainText("No mailbox linked.");
    await expect(card).toContainText("the rest of your mailbox is never stored");

    // Providers are not configured in this environment: the entry point stays inside the app
    await page.goto("/api/integrations/email/google/connect");
    await expect(page).toHaveURL(/\/settings\/profile\?email=not_configured$/);
    await expect(page.getByRole("status")).toContainText("has not been set up");
    await page.goto("/api/integrations/email/microsoft/callback?code=abc&state=forged");
    await expect(page).toHaveURL(/email=error$/);
    await page.goto("/api/integrations/email/yahoo/connect");
    await expect(page).toHaveURL(/email=error$/);

    await openNewDeal(page);
    await page.getByRole("tab", { name: "Email" }).click();
    const panel = page.getByRole("tabpanel", { name: "Email" });
    await expect(panel.getByRole("link", { name: "Link your email account" })).toHaveAttribute("href", "/settings/profile");
    await expect(panel.getByRole("button", { name: "Send email" })).toHaveCount(0);
    await expect(panel).toContainText("Or log an email you sent another way");
    await expect(panel.getByRole("button", { name: "Save" })).toBeVisible();

    const fieldPage = await (await browser.newContext()).newPage();
    await signIn(fieldPage, "field@test.local");
    await fieldPage.goto("/settings/profile");
    await expect(fieldPage.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(fieldPage.getByRole("region", { name: "Email account" })).toHaveCount(0);
  });

  test("with a linked mailbox: compose as yourself, and the conversation shows on the deal and in History", async ({ page }) => {
    await signIn(page, "sales@test.local");
    const { email, dealId } = await openNewDeal(page);
    const { data: salesProfile } = await service.from("profiles").select("id").eq("email", "sales@test.local").single();
    const mailbox = `sam.${unique()}@roofco.example`;
    const { data: account } = await service
      .from("email_accounts")
      .upsert({ user_id: salesProfile!.id, provider: "google", email_address: mailbox, status: "connected", access_token_enc: "x", refresh_token_enc: "x", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { onConflict: "user_id" })
      .select("id")
      .single();
    try {
      const base = { account_id: account!.id, thread_id: "t1", has_attachments: false };
      await service.rpc("record_email_message", { p: { ...base, provider_message_id: "e2e-out", internet_message_id: `<out-${dealId}@roofco.example>`, direction: "outbound", from_address: mailbox, to_addresses: [email], subject: "Your roof repair", snippet: "Hi, following up on the leak.", body_text: "Hi,\n\nFollowing up on the leak.\n\nSam", sent_at: new Date(Date.now() - 3_600_000).toISOString() } });
      await service.rpc("record_email_message", { p: { ...base, provider_message_id: "e2e-in", internet_message_id: `<in-${dealId}@customer.example>`, direction: "inbound", from_address: email, from_name: "Inbox Zero", to_addresses: [mailbox], subject: "Re: Your roof repair", snippet: "Thursday morning works for us.", body_text: "Thursday morning works for us.\n\nThanks!", has_attachments: true, sent_at: new Date().toISOString() } });

      await page.reload();
      await page.getByRole("tab", { name: "Email" }).click();
      const panel = page.getByRole("tabpanel", { name: "Email" });
      await expect(panel).toContainText(`From ${mailbox} to ${email}`);
      await expect(panel.getByLabel("Subject")).toBeVisible();
      await expect(panel.getByRole("button", { name: "Send email" })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Check for new email" })).toBeVisible();

      const conversation = panel.getByRole("list", { name: "Conversation" });
      await expect(conversation.getByRole("listitem")).toHaveCount(2);
      const newest = conversation.getByRole("listitem").first();
      await expect(newest).toContainText("Re: Your roof repair");
      await expect(newest.getByLabel("Received")).toBeVisible();
      await expect(newest.getByLabel("Has attachments")).toBeVisible();
      await newest.getByText("Re: Your roof repair").click();
      await expect(newest).toContainText("Thanks!");
      await expect(newest).toContainText(`Inbox Zero <${email}> → ${mailbox}`);

      // The Email tab filters History to emails
      const history = page.getByRole("region", { name: "History" });
      await expect(history.getByRole("group", { name: "Filter history" }).getByRole("button", { name: "Emails (2)" })).toHaveAttribute("aria-pressed", "true");
      await expect(history).toContainText("Email received: Re: Your roof repair");
      await expect(history).toContainText("Sam Sales emailed: Your roof repair");

      // The profile card shows the linked mailbox
      await page.goto("/settings/profile");
      const card = page.getByRole("region", { name: "Email account" });
      await expect(card).toContainText(mailbox);
      await expect(card).toContainText("Linked");
      await card.getByRole("button", { name: "Unlink" }).click();
      await card.getByRole("button", { name: "Confirm unlink" }).click();
      await expect(page.getByText("Mailbox unlinked")).toBeVisible();
      await expect(card).toContainText("No mailbox linked.");

      // Email already on the deal stays there
      await page.goto(`/opportunities/${dealId}`);
      await page.getByRole("tab", { name: "Email" }).click();
      await expect(page.getByRole("tabpanel", { name: "Email" }).getByRole("list", { name: "Conversation" }).getByRole("listitem")).toHaveCount(2);
    } finally {
      await service.from("email_accounts").delete().eq("user_id", salesProfile!.id);
    }
  });
});
