import { afterEach, describe, expect, it, vi } from "vitest";
import { logoutAndRedirect } from "./header-account";

afterEach(() => vi.unstubAllGlobals());

describe("account logout", () => {
  it("reloads the login page after the session is cleared", async () => {
    const replace = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    vi.stubGlobal("window", { location: { replace } });

    await logoutAndRedirect();

    expect(replace).toHaveBeenCalledWith("/login");
  });
});
