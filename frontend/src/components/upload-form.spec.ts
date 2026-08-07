import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  runUploadQueue,
  UploadForm,
  uploadMediaObject,
  uploadStartPayload,
  waitForMediaReady
} from "./upload-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

describe("media upload retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the selected media id as the upload id", () => {
    const media = {
      id: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce",
      file: { name: "baby.jpg", type: "image/jpeg", size: 1_024 } as File,
      albumDate: "2026-08-03",
      capturedAt: null,
      dateSource: "USER" as const,
      childTagIds: ["tag-1"],
      previewUrl: "blob:preview",
      status: "ready" as const
    };

    const first = uploadStartPayload(media);
    const retry = uploadStartPayload(media);

    expect(first.clientUploadId).toBe(media.id);
    expect(first.fileSize).toBe(1_024);
    expect(first.childTagIds).toEqual(["tag-1"]);
    expect(retry).toEqual(first);
  });

  it("bounds direct object-storage uploads", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const file = new File(["media"], "baby.jpg", { type: "image/jpeg" });

    await uploadMediaObject("https://storage.test/upload", file);

    expect(timeout).toHaveBeenCalledWith(300_000);
    expect(request.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  it("offers MP4 selection alongside supported media files", () => {
    const markup = renderToStaticMarkup(
      createElement(UploadForm, { familyId: "family-1", albumId: "album-1", childTags: [] })
    );

    expect(markup).toContain("사진·영상 선택");
    expect(markup).toContain('accept="image/jpeg,image/png,image/webp,video/mp4"');
  });

  it("polls until background media processing is ready", async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ status: "PROCESSING", failureReason: null })
      .mockResolvedValueOnce({ status: "READY", failureReason: null });
    const wait = vi.fn(async () => undefined);

    await expect(waitForMediaReady("media-1", getStatus, wait)).resolves.toBeUndefined();
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });
});

describe("media upload queue", () => {
  it("runs at most five uploads and starts the next file when one finishes", async () => {
    let active = 0;
    let maximumActive = 0;
    const started: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let releaseRemaining!: () => void;
    const remainingGate = new Promise<void>((resolve) => { releaseRemaining = resolve; });
    const queue = runUploadQueue(Array.from({ length: 10 }, (_, index) => index), async (item) => {
      started.push(item);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (item === 0) await firstGate;
      else if (item < 5) await remainingGate;
      active -= 1;
    });

    await vi.waitFor(() => expect(started).toHaveLength(5));
    releaseFirst();
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(5));
    releaseRemaining();
    await queue;

    expect(maximumActive).toBe(5);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("continues remaining files and preserves per-file results after a failure", async () => {
    const processed: number[] = [];

    const results = await runUploadQueue([0, 1, 2, 3, 4, 5], async (item) => {
      processed.push(item);
      if (item === 1) throw new Error("upload failed");
    });

    expect(processed).toHaveLength(6);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled"
    ]);
  });
});
