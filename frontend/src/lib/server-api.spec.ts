import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ toString: () => "session=test" })
}));

import { serverApi } from "./server-api";

describe("server API requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts a stalled backend request and reports service unavailable", async () => {
    const timeoutController = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      markStarted?.();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const request = serverApi("/families");
    await started;
    timeoutController.abort();

    await expect(request).rejects.toMatchObject({ status: 503 });
  });

  it("maps an interrupted response body to service unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new DOMException("Aborted", "AbortError"))
    } as Response);

    await expect(serverApi("/families")).rejects.toMatchObject({ status: 503 });
  });
});
