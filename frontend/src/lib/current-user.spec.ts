import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverApiMock } = vi.hoisted(() => ({ serverApiMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./server-api", () => ({
  ServerApiError: class ServerApiError extends Error {
    constructor(readonly status: number) {
      super(`API_${status}`);
    }
  },
  serverApi: serverApiMock
}));

import { ServerApiError } from "./server-api";
import { currentUser } from "./current-user";

describe("header session", () => {
  beforeEach(() => {
    serverApiMock.mockReset();
  });

  it("treats an unauthorized response as signed out without retrying", async () => {
    serverApiMock.mockRejectedValueOnce(new ServerApiError(401));

    await expect(currentUser()).resolves.toBeNull();
    expect(serverApiMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat a backend outage as a signed-out user", async () => {
    serverApiMock.mockRejectedValue(new ServerApiError(503));

    await expect(currentUser()).rejects.toMatchObject({ status: 503 });
    expect(serverApiMock).toHaveBeenCalledTimes(1);
  });
});
