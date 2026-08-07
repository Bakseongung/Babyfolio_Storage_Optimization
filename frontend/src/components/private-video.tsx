"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { clearPrivateMediaUrlCache, getPrivateMediaUrl } from "./private-media-url";

export function PrivateVideo({
  mediaId,
  className,
  requestKey = 0,
  onStatusChange
}: {
  mediaId: string;
  className?: string;
  requestKey?: number;
  onStatusChange?: (mediaId: string, status: "loading" | "ready" | "error") => void;
}) {
  const [source, setSource] = useState<{ mediaId: string; url: string }>();
  const onStatusRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const controller = new AbortController();
    onStatusRef.current?.(mediaId, "loading");
    void getPrivateMediaUrl(mediaId, "display", controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) setSource({ mediaId, url });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        clearPrivateMediaUrlCache(mediaId, "display");
        onStatusRef.current?.(mediaId, "error");
      });
    return () => controller.abort();
  }, [mediaId, requestKey]);

  if (source?.mediaId !== mediaId) return <Skeleton className={className} />;

  return (
    <video
      className={className}
      src={source.url}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={() => onStatusRef.current?.(mediaId, "ready")}
      onError={() => {
        clearPrivateMediaUrlCache(mediaId, "display");
        onStatusRef.current?.(mediaId, "error");
      }}
    >
      브라우저에서 이 영상을 재생할 수 없습니다.
    </video>
  );
}
