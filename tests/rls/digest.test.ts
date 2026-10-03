import { afterAll, describe, expect, it } from "vitest";
import { sendTaskDigests } from "@/features/tasks/digest";
import type { Sender } from "@/lib/integrations/resend";
import { serviceClient } from "./helpers";

const service = serviceClient();
afterAll(async () => {
  await service.from("email_log").delete().eq("template", "task_digest");
});

describe("task digest", () => {
  it("emails each user with overdue or due-today tasks once per day", async () => {
    await service.from("email_log").delete().eq("template", "task_digest");
    const delivered: { to: string; subject: string; html: string }[] = [];
    const sender: Sender = async (message) => {
      delivered.push(message);
      return { id: "re_digest" };
    };

    const first = await sendTaskDigests(sender);
    expect(first.users).toBeGreaterThanOrEqual(1); // the seed has overdue tasks for sales
    expect(first.sent).toBe(first.users);
    const sales = delivered.find((d) => d.to === "sales@test.local");
    expect(sales).toBeTruthy();
    expect(sales!.subject).toMatch(/^\d+ overdue, \d+ due today$/);
    expect(sales!.html).toContain("Overdue");
    // Field user has only a future task, so no email.
    expect(delivered.find((d) => d.to === "field@test.local")).toBeUndefined();

    const second = await sendTaskDigests(sender);
    expect(second.sent).toBe(0);
    expect(delivered).toHaveLength(first.sent);
  });
});
