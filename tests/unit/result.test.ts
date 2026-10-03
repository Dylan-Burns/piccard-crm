import { describe, expect, it } from "vitest";
import { fail, fieldErrors, ok } from "@/lib/result";

describe("result helpers", () => {
  it("ok() wraps data", () => {
    expect(ok()).toEqual({ ok: true, data: undefined });
    expect(ok({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });

  it("fail() omits fields when none are given", () => {
    expect(fail("code", "msg")).toEqual({ ok: false, error: { code: "code", message: "msg" } });
    expect(fail("code", "msg", { email: "bad" })).toEqual({
      ok: false,
      error: { code: "code", message: "msg", fields: { email: "bad" } },
    });
  });

  it("fieldErrors() keeps the first message per path", () => {
    expect(
      fieldErrors([
        { path: ["email"], message: "first" },
        { path: ["email"], message: "second" },
        { path: ["address", "city"], message: "nested" },
        { path: [], message: "root" },
      ]),
    ).toEqual({ email: "first", "address.city": "nested", _: "root" });
  });
});
