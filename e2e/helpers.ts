import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Password123!";
export const MAILPIT = "http://127.0.0.1:54424";

/** Fills and submits the sign-in form. With expectSuccess, waits until the app has left /login. */
export async function signIn(page: Page, email: string, password = PASSWORD, expectSuccess = true) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (expectSuccess) await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** The app's own error banner (Next.js also renders an empty role=alert route announcer). */
export function errorBanner(page: Page) {
  return page.locator("p[role=alert]");
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Returns the first link in the newest email sent to `to` (local Mailpit). */
export async function latestEmailLink(to: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
      const match = /href="([^"]+)"/.exec(message.HTML as string);
      if (match?.[1]) return match[1].replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email found for ${to}`);
}
