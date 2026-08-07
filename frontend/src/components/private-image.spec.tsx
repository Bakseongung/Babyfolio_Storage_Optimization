import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientApiMock } = vi.hoisted(() => ({ clientApiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ clientApi: clientApiMock }));

import {
  PrivateImage,
  shouldRequestPrivateImage
} from "./private-image";
import {
  clearPrivateMediaUrlCache,
  getPrivateMediaUrl,
  MAX_SIGNED_URL_CACHE_ENTRIES
} from "./private-media-url";

describe("private image requests", () => {
  beforeEach(() => {
    clearPrivateMediaUrlCache();
    clientApiMock.mockReset();
  });

  it("does not request an off-screen thumbnail but loads a display image immediately", () => {
    expect(shouldRequestPrivateImage("thumbnail", "media-2:thumbnail", "media-1:thumbnail")).toBe(false);
    expect(shouldRequestPrivateImage("display", null, "media-1:display")).toBe(true);
  });

  it("reuses a fresh signed URL instead of requesting it on every render", async () => {
    clientApiMock.mockResolvedValue({ url: "https://storage.test/media-1" });

    await getPrivateMediaUrl("media-1", "thumbnail");
    await getPrivateMediaUrl("media-1", "thumbnail");

    expect(clientApiMock).toHaveBeenCalledOnce();
  });

  it("forwards cancellation and can invalidate an expired image URL", async () => {
    const controller = new AbortController();
    clientApiMock
      .mockResolvedValueOnce({ url: "https://storage.test/expired" })
      .mockResolvedValueOnce({ url: "https://storage.test/fresh" });

    await getPrivateMediaUrl("media-1", "thumbnail", controller.signal);
    clearPrivateMediaUrlCache("media-1", "thumbnail");
    await expect(getPrivateMediaUrl("media-1", "thumbnail", controller.signal))
      .resolves.toBe("https://storage.test/fresh");

    expect(clientApiMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(clientApiMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the signed URL cache for long media feeds", async () => {
    clientApiMock.mockImplementation(async (path: string) => ({ url: `https://storage.test${path}` }));

    for (let index = 0; index <= MAX_SIGNED_URL_CACHE_ENTRIES; index += 1) {
      await getPrivateMediaUrl(`media-${index}`, "thumbnail");
    }
    await getPrivateMediaUrl("media-0", "thumbnail");

    expect(clientApiMock).toHaveBeenCalledTimes(MAX_SIGNED_URL_CACHE_ENTRIES + 2);
  });

  it("keeps hooks stable for both image variants", () => {
    expect(() => renderToStaticMarkup(
      <>
        <PrivateImage mediaId="media-1" variant="thumbnail" alt="썸네일" />
        <PrivateImage mediaId="media-1" variant="display" alt="확대 사진" />
      </>
    )).not.toThrow();
  });
});
