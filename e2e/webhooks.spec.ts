import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Local test secrets from .env.local
const WEBHOOK_SECRET = "local-test-webhook-secret-0123456789";
const GOOGLE_KEY = "local-test-google-ads-key";
const CRON_SECRET = "local-test-cron-secret-0123456789";
const n = () => String(Date.now()).slice(-7);

test.describe("lead webhooks", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "API tests run once");
  });

  test("website webhook: wrong secret is 401, right secret creates a lead visible in the inbox", async ({ page, request }) => {
    const id = n();
    const body = { submission_id: `e2e-${id}`, name: `Hook Lead${id}`, phone: `415555${id.slice(-4)}`, address: `${id} Webhook Way`, zip: "62701", service: "Gutters", message: "From the website" };

    expect((await request.post("/api/webhooks/leads/website", { data: body })).status()).toBe(401);
    expect((await request.post("/api/webhooks/leads/website", { data: body, headers: { "x-webhook-secret": "wrong" } })).status()).toBe(401);

    const ok = await request.post("/api/webhooks/leads/website", { data: body, headers: { "x-webhook-secret": WEBHOOK_SECRET } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    // A replay of the same delivery is acknowledged and creates nothing.
    const replay = await request.post("/api/webhooks/leads/website", { data: body, headers: { "x-webhook-secret": WEBHOOK_SECRET } });
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });

    await signIn(page, "admin@test.local");
    await expect(async () => {
      await page.goto("/leads");
      await expect(page.getByRole("link", { name: `Hook Lead${id}` })).toHaveCount(1);
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("row", { name: new RegExp(`Hook Lead${id}`) })).toContainText("Website");

    await page.goto("/settings/integrations");
    await expect(page.getByRole("listitem").filter({ hasText: `Hook Lead${id}` })).toContainText("Created");
  });

  test("google ads webhook: key is checked, the same lead_id creates one deal, test leads create nothing", async ({ request }) => {
    const id = n();
    const payload = {
      google_key: GOOGLE_KEY, lead_id: `e2e-g-${id}`, form_id: 1, campaign_id: 2, gcl_id: "abc",
      user_column_data: [{ column_id: "FULL_NAME", string_value: `Ads Lead${id}` }, { column_id: "PHONE_NUMBER", string_value: `+1415555${id.slice(-4)}` }],
    };
    expect((await request.post("/api/webhooks/leads/google-ads", { data: { ...payload, google_key: "nope" } })).status()).toBe(401);
    expect((await request.post("/api/webhooks/leads/google-ads", { data: "not json", headers: { "content-type": "text/plain" } })).status()).toBe(400);
    expect(await (await request.post("/api/webhooks/leads/google-ads", { data: payload })).json()).toEqual({ ok: true });
    expect(await (await request.post("/api/webhooks/leads/google-ads", { data: payload })).json()).toEqual({ ok: true, duplicate: true });
  });

  test("cron route requires its secret", async ({ request }) => {
    expect((await request.get("/api/cron/process-outbox")).status()).toBe(401);
    const ok = await request.get("/api/cron/process-outbox", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  test("the webhook secret never reaches the browser", async ({ page }) => {
    await signIn(page, "admin@test.local");
    await page.goto("/settings/integrations");
    await expect(page.getByLabel("Website webhook URL")).toHaveValue(/\/api\/webhooks\/leads\/website$/);
    const html = await page.content();
    expect(html).not.toContain(WEBHOOK_SECRET);
    expect(html).not.toContain(GOOGLE_KEY);

    await page.getByRole("button", { name: "Send test lead" }).click();
    await expect(page.getByText("Test lead created. Check the Leads page.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Test Lead" }).first()).toContainText("Created");
  });
});
