"use client";

import { clientApi } from "@/lib/api";

export type PrivateMediaVariant = "thumbnail" | "display";

type CachedUrl = { url: string; expiresAt: number };

const signedUrlCache = new Map<string, CachedUrl>();
const SIGNED_URL_CACHE_MS = 60_000;
export const MAX_SIGNED_URL_CACHE_ENTRIES = 160;

export function privateMediaKey(mediaId: string, variant: PrivateMediaVariant) {
  return `${mediaId}:${variant}`;
}

export function clearPrivateMediaUrlCache(mediaId?: string, variant?: PrivateMediaVariant) {
  if (!mediaId) {
    signedUrlCache.clear();
    return;
  }
  if (variant) {
    signedUrlCache.delete(privateMediaKey(mediaId, variant));
    return;
  }
  signedUrlCache.delete(privateMediaKey(mediaId, "thumbnail"));
  signedUrlCache.delete(privateMediaKey(mediaId, "display"));
}

export async function getPrivateMediaUrl(
  mediaId: string,
  variant: PrivateMediaVariant,
  signal?: AbortSignal
) {
  const key = privateMediaKey(mediaId, variant);
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (cached) signedUrlCache.delete(key);

  const result = await clientApi<{ url: string }>(
    `/media/${mediaId}/url?variant=${variant}`,
    { signal }
  );
  signedUrlCache.set(key, {
    url: result.url,
    expiresAt: Date.now() + SIGNED_URL_CACHE_MS
  });
  if (signedUrlCache.size > MAX_SIGNED_URL_CACHE_ENTRIES) {
    signedUrlCache.delete(signedUrlCache.keys().next().value!);
  }
  return result.url;
}
