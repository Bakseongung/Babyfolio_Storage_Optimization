import { afterEach, describe, expect, it, vi } from "vitest";
import { clientApi } from "./api";

describe("client API requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a timeout signal to every request", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(clientApi<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });

    expect(timeout).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.signal).toBe(timeoutSignal);
  });

  it("allows long-running operations to choose a longer timeout", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await clientApi<void>("/media/media-1/complete", { method: "POST" }, 120_000);

    expect(timeout).toHaveBeenCalledWith(120_000);
  });

  it("lets a caller abort an in-flight request", async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const request = clientApi("/media/media-1/url", { signal: caller.signal });
    caller.abort();

    await expect(request).rejects.toThrow("서버에 연결하지 못했습니다");
  });

  it("does not treat an interrupted response body as a successful empty result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new DOMException("Aborted", "AbortError"))
    } as Response);

    await expect(clientApi("/families")).rejects.toThrow("서버에 연결하지 못했습니다");
  });

  it("accepts a successful response without a body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(clientApi<void>("/albums/album-1/child-tags/tag-1", {
      method: "DELETE"
    })).resolves.toBeUndefined();
  });

  it("preserves backend error codes for UI handling", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "INVALID_VIDEO",
      message: "영상 파일이 올바르지 않습니다."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }));

    const error = await clientApi("/media/media-1/complete").catch((error: unknown) => error as Error & { code?: string });

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("clientApi did not return an Error");
    expect(error.message).toBe("영상 파일이 올바르지 않습니다.");
    expect((error as Error & { code?: string }).code).toBe("INVALID_VIDEO");
  });
});
