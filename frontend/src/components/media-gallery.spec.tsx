import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  canInteractWithMedia,
  nextPresentedMediaId,
  panZoom,
  mediaSwipeDirection,
  MediaGallery,
  zoomAtPoint
} from "./media-gallery";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

describe("media gallery empty state", () => {
  it("opens media upload for the selected date", () => {
    const uploadHref = "/families/family-1/albums/album-1/upload?date=2026-07-02";
    const markup = renderToStaticMarkup(
      <MediaGallery
        mediaItems={[]}
        currentUserId="user-1"
        canDeleteAll={false}
        uploadHref={uploadHref}
      />
    );

    expect(markup).toContain(`href="${uploadHref}"`);
    expect(markup).toContain("첫 기록 추가하기");
  });

  it("server-renders the initial virtualized feed items", () => {
    const markup = renderToStaticMarkup(
      <MediaGallery
        mediaItems={[{
          id: "media-1",
          albumDate: "2026-08-03",
          originalName: "첫 사진.jpg",
          uploadedById: "user-1",
          createdAt: "2026-08-03T00:00:00.000Z",
          mediaAsset: { width: 640, height: 640 },
          childTags: []
        }]}
        currentUserId="user-1"
        canDeleteAll
        uploadHref="/upload"
      />
    );

    expect(markup).toContain("첫 사진.jpg");
  });
});

describe("video gallery", () => {
  it("marks MP4 items as playable videos", () => {
    const markup = renderToStaticMarkup(
      <MediaGallery
        mediaItems={[{
          id: "video-1",
          albumDate: "2026-08-03",
          originalName: "첫 걸음.mp4",
          uploadedById: "user-1",
          createdAt: "2026-08-03T00:00:00.000Z",
          mediaAsset: { width: 1920, height: 1080, mimeType: "video/mp4" },
          childTags: []
        }]}
        currentUserId="user-1"
        canDeleteAll
        uploadHref="/upload"
      />
    );

    expect(markup).toContain('aria-label="첫 걸음.mp4 영상 재생"');
  });
});

describe("media gallery zoom", () => {
  it("keeps the image point under the mouse pointer while zooming", () => {
    const pointer = { x: 240, y: 160 };
    const current = { scale: 1, x: 0, y: 0 };
    const next = zoomAtPoint(current, -1, pointer);

    expect(next.scale).toBe(1.25);
    expect((pointer.x - next.x) / next.scale).toBeCloseTo(pointer.x);
    expect((pointer.y - next.y) / next.scale).toBeCloseTo(pointer.y);
  });

  it("blocks actions while the selected media is not the displayed media", () => {
    expect(canInteractWithMedia("media-2", { mediaId: "media-1", status: "ready" })).toBe(false);
    expect(canInteractWithMedia("media-2", { mediaId: "media-2", status: "loading" })).toBe(false);
    expect(canInteractWithMedia("media-2", { mediaId: "media-2", status: "ready" })).toBe(true);
  });

  it("keeps the current metadata until the decoded image is ready", () => {
    expect(nextPresentedMediaId("media-1", "media-2", "loading")).toBe("media-1");
    expect(nextPresentedMediaId("media-1", "media-2", "ready")).toBe("media-2");
  });
});

describe("media gallery touch navigation", () => {
  it("changes mediaItems only for a clear horizontal swipe", () => {
    expect(mediaSwipeDirection({ x: 200, y: 100 }, { x: 120, y: 105 })).toBe(1);
    expect(mediaSwipeDirection({ x: 120, y: 100 }, { x: 200, y: 105 })).toBe(-1);
    expect(mediaSwipeDirection({ x: 200, y: 100 }, { x: 180, y: 170 })).toBe(0);
  });

  it("keeps a zoomed media inside the viewport while dragging", () => {
    expect(panZoom(
      { scale: 2, x: -100, y: -50 },
      { x: 500, y: -500 },
      { width: 300, height: 200 }
    )).toEqual({ scale: 2, x: 0, y: -200 });
  });
});
