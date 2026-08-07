import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock, redirectMock, serverApiMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirectMock: vi.fn(() => { throw new Error("REDIRECT"); }),
  serverApiMock: vi.fn()
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("./server-api", () => ({
  ServerApiError: class ServerApiError extends Error {
    constructor(readonly status: number) {
      super(`API_${status}`);
    }
  },
  serverApi: serverApiMock
}));

import { ServerApiError } from "./server-api";
import { protectedApi } from "./protected-api";

describe("protected page API requests", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    redirectMock.mockClear();
    serverApiMock.mockReset();
  });

  it("redirects an expired session to login", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(401));

    await expect(protectedApi("/families")).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("preserves a safe protected-page destination when the session expires", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(401));

    await expect(protectedApi(
      "/albums/album-1/calendar",
      "/families/family-1/albums/album-1/calendar?month=2026-08"
    )).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(
      "/login?returnTo=%2Ffamilies%2Ffamily-1%2Falbums%2Falbum-1%2Fcalendar%3Fmonth%3D2026-08"
    );
  });

  it("renders not found for a missing protected resource", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(404));

    await expect(protectedApi("/albums/missing/calendar")).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("does not hide backend failures", async () => {
    const error = new ServerApiError(503);
    serverApiMock.mockRejectedValue(error);

    await expect(protectedApi("/families")).rejects.toBe(error);
  });
});
