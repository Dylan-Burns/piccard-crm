import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";

let admin: Client, sales: Client, field: Client;
let adminId: string, salesId: string, fieldId: string;
const service = serviceClient();

beforeAll(async () => {
  ({ client: admin, userId: adminId } = await signInAs("admin@test.local"));
  ({ client: sales, userId: salesId } = await signInAs("sales@test.local"));
  ({ client: field, userId: fieldId } = await signInAs("field@test.local"));
});

afterAll(async () => {
  // Restore anything a failed test may have left behind.
  await service.from("profiles").update({ role: "sales", is_active: true, full_name: "Sam Sales" }).eq("id", salesId);
  await service.from("profiles").update({ role: "field", is_active: true }).eq("id", fieldId);
  await service.from("company_settings").update({ company_name: "Roofing Company" }).eq("id", true);
});

describe("profiles", () => {
  it("lets every active user read all profiles", async () => {
    const { data, error } = await field.from("profiles").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(3);
  });

  it("lets a user edit their own name", async () => {
    const { error } = await sales.from("profiles").update({ full_name: "Sam S." }).eq("id", salesId);
    expect(error).toBeNull();
    const { data } = await sales.from("profiles").select("full_name").eq("id", salesId).single();
    expect(data!.full_name).toBe("Sam S.");
  });

  it("blocks a sales user from promoting themselves", async () => {
    const { error } = await sales.from("profiles").update({ role: "admin" }).eq("id", salesId);
    expect(error?.code).toBe("42501");
    const { data } = await service.from("profiles").select("role").eq("id", salesId).single();
    expect(data!.role).toBe("sales");
  });

  it("blocks a user from changing their own email (column not granted)", async () => {
    const { error } = await sales.from("profiles").update({ email: "x@test.local" }).eq("id", salesId);
    expect(error?.code).toBe("42501");
  });

  it("does not let a sales user edit someone else", async () => {
    await sales.from("profiles").update({ full_name: "Hacked" }).eq("id", fieldId);
    const { data } = await service.from("profiles").select("full_name").eq("id", fieldId).single();
    expect(data!.full_name).toBe("Fran Field");
  });

  it("lets an admin change another user's role", async () => {
    const { error } = await admin.from("profiles").update({ role: "sales" }).eq("id", fieldId);
    expect(error).toBeNull();
    const { data } = await service.from("profiles").select("role").eq("id", fieldId).single();
    expect(data!.role).toBe("sales");
    await admin.from("profiles").update({ role: "field" }).eq("id", fieldId);
  });

  it("shows a deactivated user only their own row, and nothing else", async () => {
    await service.from("profiles").update({ is_active: false }).eq("id", fieldId);
    const { data: rows } = await field.from("profiles").select("id, is_active");
    expect(rows).toEqual([{ id: fieldId, is_active: false }]);
    const { data: settings } = await field.from("company_settings").select("id");
    expect(settings).toEqual([]);
    // and cannot reactivate themselves
    const { error } = await field.from("profiles").update({ is_active: true }).eq("id", fieldId);
    expect(error?.code).toBe("42501");
    await service.from("profiles").update({ is_active: true }).eq("id", fieldId);
  });
});

describe("company_settings", () => {
  it("is readable by any active user and writable only by admins", async () => {
    const { data } = await field.from("company_settings").select("company_name").single();
    expect(data!.company_name).toBeTruthy();

    await sales.from("company_settings").update({ company_name: "Nope" }).eq("id", true);
    const { data: after } = await service.from("company_settings").select("company_name").single();
    expect(after!.company_name).not.toBe("Nope");

    const { error } = await admin.from("company_settings").update({ company_name: "Piccard Test" }).eq("id", true);
    expect(error).toBeNull();
    const { data: changed } = await service.from("company_settings").select("company_name").single();
    expect(changed!.company_name).toBe("Piccard Test");
  });
});

describe("anon", () => {
  it("cannot read any table", async () => {
    const anon = anonClient();
    for (const table of ["profiles", "company_settings"] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(error?.code, table).toBe("42501");
      expect(data).toBeNull();
    }
  });

  it("cannot call private helpers over the API", async () => {
    const anon = anonClient();
    // `private` is not an exposed schema, so the RPC is not found at all.
    const { error } = await (anon as unknown as { rpc: (fn: string) => Promise<{ error: unknown }> }).rpc("auth_role");
    expect(error).toBeTruthy();
    expect(adminId).toBeTruthy();
  });
});
