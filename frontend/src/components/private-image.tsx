"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearPrivateMediaUrlCache,
  getPrivateMediaUrl,
  privateMediaKey,
  type PrivateMediaVariant
} from "./private-media-url";

type ImageSource = {
  mediaId: string;
  variant: PrivateMediaVariant;
  url: string;
  alt: string;
};

export function shouldRequestPrivateImage(
  variant: PrivateMediaVariant,
  visibleKey: string | null,
  key: string
) {
  return variant === "display" || visibleKey === key;
}

export function PrivateImage({
  mediaId,
  variant = "thumbnail",
  alt,
  className,
  requestKey = 0,
  onStatusChange
}: {
  mediaId: string;
  variant?: PrivateMediaVariant;
  alt: string;
  className?: string;
  requestKey?: number;
  onStatusChange?: (mediaId: string, status: "loading" | "ready" | "error") => void;
}) {
  const key = privateMediaKey(mediaId, variant);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const [source, setSource] = useState<ImageSource>();
  const [reloadKey, setReloadKey] = useState(0);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef({ scope: "", attempted: false });
  const onStatusRef = useRef(onStatusChange);
  const shouldRequest = shouldRequestPrivateImage(variant, visibleKey, key);

  useEffect(() => {
    onStatusRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (variant === "display") return;
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisibleKey(key);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleKey(key);
      observer.disconnect();
    }, { rootMargin: "320px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [key, variant]);

  useEffect(() => {
    if (!shouldRequest) return;
    const controller = new AbortController();
    onStatusRef.current?.(mediaId, "loading");

    void getPrivateMediaUrl(mediaId, variant, controller.signal)
      .then(async (url) => {
        if (variant === "display") {
          const image = new window.Image();
          image.src = url;
          await image.decode();
        }
        if (controller.signal.aborted) return;
        setSource({ mediaId, variant, url, alt });
        onStatusRef.current?.(mediaId, "ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        clearPrivateMediaUrlCache(mediaId, variant);
        onStatusRef.current?.(mediaId, "error");
      });

    return () => controller.abort();
  }, [alt, mediaId, reloadKey, requestKey, shouldRequest, variant]);

  const displayedSource = variant === "display"
    ? source
    : source?.mediaId === mediaId && source.variant === variant
      ? source
      : undefined;

  function handleImageError() {
    if (!displayedSource || displayedSource.mediaId !== mediaId) return;
    clearPrivateMediaUrlCache(mediaId, variant);
    const retryScope = `${key}:${requestKey}`;
    if (retryRef.current.scope !== retryScope) {
      retryRef.current = { scope: retryScope, attempted: false };
    }
    if (!retryRef.current.attempted) {
      retryRef.current.attempted = true;
      setReloadKey((current) => current + 1);
      return;
    }
    onStatusRef.current?.(mediaId, "error");
  }

  if (!displayedSource) {
    return (
      <Skeleton
        ref={targetRef}
        className={className}
        aria-hidden={alt === "" ? true : undefined}
        aria-label={alt ? `${alt} 불러오는 중` : undefined}
      />
    );
  }

  return (
    // Backend-generated, short-lived signed derivatives are already resized for each view.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={displayedSource.url}
      alt={displayedSource.alt}
      width={640}
      height={640}
      loading={variant === "display" ? "eager" : "lazy"}
      decoding="async"
      onError={handleImageError}
    />
  );
}
