"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { clientApi } from "@/lib/api";
import type { Media, MediaFeedPage } from "@/lib/types";
import { MediaGallery } from "./media-gallery";

export function appendUniqueMedia(current: Media[], incoming: Media[]): Media[] {
  const knownIds = new Set(current.map(({ id }) => id));
  return [...current, ...incoming.filter(({ id }) => !knownIds.has(id))];
}

export function MediaFeed({
  initialPage,
  feedPath,
  currentUserId,
  canDeleteAll,
  uploadHref,
  emptyTitle
}: {
  initialPage: MediaFeedPage;
  feedPath: string;
  currentUserId: string;
  canDeleteAll: boolean;
  uploadHref: string;
  emptyTitle: string;
}) {
  const [page, setPage] = useState(initialPage);
  const { items: mediaItems, nextCursor } = page;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if ((!nextCursor && !reset) || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const separator = feedPath.includes("?") ? "&" : "?";
      const page = await clientApi<MediaFeedPage>(
        reset ? feedPath : `${feedPath}${separator}cursor=${encodeURIComponent(nextCursor!)}`
      );
      setPage((current) => reset ? page : ({
        items: appendUniqueMedia(current.items, page.items),
        nextCursor: page.nextCursor
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기록을 더 불러오지 못했습니다.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [feedPath, nextCursor]);

  const loadMore = useCallback(() => loadPage(mediaItems.length === 0), [loadPage, mediaItems.length]);

  const handleMediaRemoved = useCallback((mediaId: string) => {
    const items = page.items.filter(({ id }) => id !== mediaId);
    const exhausted = page.nextCursor === mediaId && items.length === 0;
    setPage({
      items,
      nextCursor: page.nextCursor === mediaId
        ? items.at(-1)?.id ?? (exhausted ? mediaId : null)
        : page.nextCursor
    });
    if (exhausted) void loadPage(true);
  }, [loadPage, page]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  return (
    <>
      <MediaGallery
        mediaItems={mediaItems}
        currentUserId={currentUserId}
        canDeleteAll={canDeleteAll}
        uploadHref={uploadHref}
        emptyTitle={emptyTitle}
        emptyDescription="다른 필터를 선택하거나 새 사진·영상을 추가해 보세요."
        showDate
        onMediaRemoved={handleMediaRemoved}
      />
      {nextCursor ? (
        <div
          ref={sentinelRef}
          data-media-feed-sentinel
          className="flex min-h-20 items-center justify-center"
          aria-live="polite"
        >
          {loading ? (
            <span className="muted inline-flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              기록 불러오는 중…
            </span>
          ) : error ? (
            <Button type="button" variant="outline" onClick={() => void loadMore()}>
              다시 시도
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="sr-only focus:not-sr-only"
              onClick={() => void loadMore()}
            >
              다음 기록 불러오기
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
