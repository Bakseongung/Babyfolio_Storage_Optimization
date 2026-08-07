// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Media } from "@/lib/types";

const clientApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ clientApi: clientApiMock }));

vi.mock("./media-gallery", () => ({
  MediaGallery: ({
    mediaItems,
    onMediaRemoved
  }: {
    mediaItems: Media[];
    onMediaRemoved?: (mediaId: string) => void;
  }) => (
    <div data-testid="gallery">
      <span data-media-ids>{mediaItems.map(({ id }) => id).join(",")}</span>
      <button type="button" onClick={() => onMediaRemoved?.("old")}>delete</button>
    </div>
  )
}));

import { appendUniqueMedia, MediaFeed } from "./media-feed";

function media(id: string): Media {
  return {
    id,
    albumDate: "2026-08-03",
    originalName: `${id}.jpg`,
    uploadedById: "user-1",
    createdAt: "2026-08-03T00:00:00.000Z",
    mediaAsset: { width: 640, height: 640 },
    childTags: []
  };
}

describe("MediaFeed", () => {
  it("appends cursor pages without retaining duplicate mediaItems", () => {
    expect(appendUniqueMedia([media("1"), media("2")], [media("2"), media("3")]).map(({ id }) => id))
      .toEqual(["1", "2", "3"]);
  });

  it("renders an automatic loading sentinel instead of a load-more button", () => {
    const markup = renderToStaticMarkup(
      <MediaFeed
        initialPage={{ items: [media("1")], nextCursor: "next" }}
        feedPath="/albums/album-1/media-feed?take=40"
        currentUserId="user-1"
        canDeleteAll
        uploadHref="/upload"
        emptyTitle="사진이 없습니다"
      />
    );

    expect(markup).toContain("data-media-feed-sentinel");
    expect(markup).not.toContain("사진 더 보기");
  });

  it("refills the first page after deleting the last loaded cursor media", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clientApiMock.mockResolvedValueOnce({ items: [media("older")], nextCursor: null });
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      feedPath: "/albums/album-1/media-feed?take=40",
      currentUserId: "user-1",
      canDeleteAll: true,
      uploadHref: "/upload",
      emptyTitle: "사진이 없습니다"
    };

    await act(async () => root.render(
      <MediaFeed initialPage={{ items: [media("old")], nextCursor: "old" }} {...props} />
    ));
    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(clientApiMock).toHaveBeenCalledWith(props.feedPath);
    expect(container.querySelector("[data-media-ids]")?.textContent).toBe("older");
    expect(container.querySelector("[data-media-feed-sentinel]")).toBeNull();
    act(() => root.unmount());
  });
});
