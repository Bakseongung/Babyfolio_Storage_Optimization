import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock, serverApiMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  serverApiMock: vi.fn()
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/server-api", () => ({
  ServerApiError: class ServerApiError extends Error {
    constructor(readonly status: number) {
      super(`API_${status}`);
    }
  },
  serverApi: serverApiMock
}));

import { ServerApiError } from "@/lib/server-api";
import InvitePage from "./page";

describe("invite page", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    serverApiMock.mockReset();
  });

  it("renders not found only for a missing invite", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(404));

    await expect(InvitePage({ params: Promise.resolve({ token: "missing" }) }))
      .rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("lets backend outages reach the error boundary", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(503));

    await expect(InvitePage({ params: Promise.resolve({ token: "valid" }) }))
      .rejects.toMatchObject({ status: 503 });
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
