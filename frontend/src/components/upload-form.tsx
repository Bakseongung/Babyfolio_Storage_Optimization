"use client";

import exifr from "exifr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientApi } from "@/lib/api";
import {
  suggestMediaDate,
  type MediaDateSource
} from "@/lib/media-date";
import type { ChildTag } from "@/lib/types";

export type PendingMedia = {
  id: string;
  file: File;
  albumDate: string;
  capturedAt: string | null;
  dateSource: MediaDateSource;
  childTagIds: string[];
  previewUrl: string;
  status: "ready" | "uploading" | "done" | "error";
  error?: string;
};

type UploadStart = {
  mediaId: string;
  uploadUrl: string | null;
};

export const MAX_PARALLEL_UPLOADS = 5;

export async function runUploadQueue<T>(
  items: readonly T[],
  uploadItem: (item: T) => Promise<void>
): Promise<PromiseSettledResult<void>[]> {
  const results = new Array<PromiseSettledResult<void>>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        await uploadItem(items[index]);
        results[index] = { status: "fulfilled", value: undefined };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, items.length) }, () => worker())
  );
  return results;
}

const DATE_SOURCE_LABEL: Record<MediaDateSource, string> = {
  EXIF_ORIGINAL: "사진 촬영일",
  EXIF_CREATED: "사진 생성일",
  FILE_MODIFIED: "파일 날짜",
  USER: "직접 선택",
  DEFAULT: "오늘"
};

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4"
]);

function maxFileSize(file: File) {
  return contentType(file) === "video/mp4" ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function contentType(file: File) {
  return file.type;
}

export async function uploadMediaObject(url: string, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType(file) },
      body: file,
      signal: AbortSignal.timeout(300_000)
    });
  } catch {
    throw new Error("파일 전송 시간이 초과되었거나 연결이 끊겼습니다.");
  }
  if (!response.ok) throw new Error("파일 전송에 실패했습니다.");
}

type MediaProcessingStatus = {
  status: "PENDING_UPLOAD" | "PROCESSING" | "READY" | "FAILED";
  failureReason: string | null;
};

export async function waitForMediaReady(
  mediaId: string,
  getStatus: (mediaId: string) => Promise<MediaProcessingStatus> = (id) =>
    clientApi<MediaProcessingStatus>(`/media/${id}/status`),
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<void> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const result = await getStatus(mediaId);
    if (result.status === "READY") return;
    if (result.status === "FAILED") {
      throw new Error(result.failureReason === "INVALID_VIDEO"
        ? "H.264 영상과 AAC 음성을 사용하는 MP4 파일만 올릴 수 있습니다."
        : "파일 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
    await wait(1_000);
  }
  throw new Error("파일 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
}

export function uploadStartPayload(media: PendingMedia) {
  return {
    date: media.albumDate,
    capturedAt: media.capturedAt ?? undefined,
    dateSource: media.dateSource,
    originalName: media.file.name,
    contentType: contentType(media.file),
    fileSize: media.file.size,
    clientUploadId: media.id,
    childTagIds: media.childTagIds
  };
}

export function UploadForm({
  familyId,
  albumId,
  defaultDate,
  childTags
}: {
  familyId: string;
  albumId: string;
  defaultDate?: string;
  childTags: ChildTag[];
}) {
  const router = useRouter();
  const previewUrls = useRef(new Set<string>());
  const [mediaItems, setMediaItems] = useState<PendingMedia[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const month = (defaultDate ?? localToday()).slice(0, 7);
  const backHref = defaultDate
    ? `/families/${familyId}/albums/${albumId}/date/${defaultDate}`
    : `/families/${familyId}/albums/${albumId}/calendar?month=${month}`;

  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setMessage("");

    if (!files.length) return;
    if (files.length > 10) {
      setMessage("사진과 영상은 한 번에 최대 10개까지 선택할 수 있어요.");
      return;
    }
    if (files.some((file) => file.size > maxFileSize(file))) {
      setMessage("사진은 20MB, 영상은 200MB 이하여야 해요.");
      return;
    }
    if (files.some((file) => !ALLOWED_TYPES.has(contentType(file)))) {
      setMessage("JPG, PNG, WebP 사진과 MP4 영상만 올릴 수 있어요.");
      return;
    }

    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setMediaItems([]);
    setReading(true);
    try {
      const nextMedia: PendingMedia[] = [];
      for (const file of files) {
        const metadata = contentType(file).startsWith("image/")
          ? await exifr
              .parse(file, ["DateTimeOriginal", "CreateDate"])
              .catch(() => undefined) as
              | { DateTimeOriginal?: Date; CreateDate?: Date }
              | undefined
          : undefined;
        const suggestion = suggestMediaDate({
          defaultDate,
          dateTimeOriginal: metadata?.DateTimeOriginal,
          createDate: metadata?.CreateDate,
          fileLastModified: file.lastModified
            ? new Date(file.lastModified)
            : undefined,
          today: localToday()
        });

        nextMedia.push({
          id: crypto.randomUUID(),
          file,
          childTagIds: selectedTagIds,
          previewUrl: URL.createObjectURL(file),
          status: "ready",
          ...suggestion
        });
      }
      nextMedia.forEach((media) => previewUrls.current.add(media.previewUrl));
      setMediaItems(nextMedia);
    } finally {
      setReading(false);
    }
  }

  function changeDate(id: string, albumDate: string) {
    setMediaItems((current) =>
      current.map((media) =>
        media.id === id
          ? { ...media, albumDate, dateSource: "USER" }
          : media
      )
    );
  }

  function toggleTag(id: string) {
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((tagId) => tagId !== id)
      : [...selectedTagIds, id];
    setSelectedTagIds(next);
    setMediaItems((mediaItems) =>
      mediaItems.map((media) =>
        media.status === "done" ? media : { ...media, childTagIds: next }
      )
    );
  }

  function toggleMediaTag(mediaId: string, tagId: string) {
    setMediaItems((current) =>
      current.map((media) =>
        media.id !== mediaId
          ? media
          : {
              ...media,
              childTagIds: media.childTagIds.includes(tagId)
                ? media.childTagIds.filter((id) => id !== tagId)
                : [...media.childTagIds, tagId]
            }
      )
    );
  }

  function removeMedia(media: PendingMedia) {
    URL.revokeObjectURL(media.previewUrl);
    previewUrls.current.delete(media.previewUrl);
    setMediaItems((current) => current.filter((item) => item.id !== media.id));
  }

  async function upload() {
    const pendingMedia = mediaItems.filter((media) => media.status !== "done");
    if (!pendingMedia.length) return;
    setUploading(true);
    setMessage("");
    try {
      const results = await runUploadQueue(pendingMedia, async (media) => {
        setMediaItems((current) =>
          current.map((item) =>
            item.id === media.id
              ? { ...item, status: "uploading", error: undefined }
              : item
          )
        );
        try {
          const start = await clientApi<UploadStart>(
            `/albums/${albumId}/uploads`,
            {
              method: "POST",
              body: JSON.stringify(uploadStartPayload(media))
            }
          );
          if (start.uploadUrl) {
            await uploadMediaObject(start.uploadUrl, media.file);
          }
          await clientApi(`/media/${start.mediaId}/complete`, {
            method: "POST"
          });
          await waitForMediaReady(start.mediaId);
          setMediaItems((current) =>
            current.map((item) =>
              item.id === media.id ? { ...item, status: "done" } : item
            )
          );
        } catch (error) {
          const detail = error instanceof Error
            ? error.message
            : "파일을 올리지 못했습니다.";
          setMediaItems((current) =>
            current.map((item) =>
              item.id === media.id
                ? { ...item, status: "error", error: detail }
                : item
            )
          );
          throw error;
        }
      });
      const completed = results.filter(({ status }) => status === "fulfilled").length;
      const failed = results.length - completed;

      if (failed) {
        setMessage(`${completed}개 완료 · ${failed}개 실패했습니다. 실패한 파일만 다시 시도해 주세요.`);
        return;
      }
      const dates = [...new Set(mediaItems.map((media) => media.albumDate))];
      router.push(
        dates.length === 1
          ? `/families/${familyId}/albums/${albumId}/date/${dates[0]}`
          : `/families/${familyId}/albums/${albumId}/calendar?month=${dates[0].slice(0, 7)}`
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <Button asChild variant="link" className="page-back mb-4">
        <Link href={backHref}>
          <ArrowLeft aria-hidden="true" />
          앨범으로 돌아가기
        </Link>
      </Button>
      <p className="eyebrow mb-2">앨범에 기록하기</p>
      <h1 className="brand text-3xl font-extrabold sm:text-4xl">사진·영상 추가</h1>
      <p className="muted mt-2 text-base leading-7">
        촬영일을 찾으면 날짜를 먼저 채워드려요. 올리기 전에 확인하거나
        바꿀 수 있습니다.
      </p>

      {childTags.length > 0 && (
        <fieldset className="mt-7 rounded-2xl border border-border bg-card p-5 shadow-[0_2px_8px_rgb(17_24_39/0.04)] sm:p-6">
          <legend className="px-1 text-[15px] font-bold">사진·영상에 나온 아이</legend>
          <p className="muted mt-1 text-[15px]">
            모든 파일의 기본 태그예요. 아래에서 파일마다 바꿀 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {childTags.map((tag) => {
              const selected = selectedTagIds.includes(tag.id);
              return (
                <Label
                  key={tag.id}
                  htmlFor={`upload-tag-${tag.id}`}
                  data-selected={selected}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 transition-colors hover:bg-secondary data-[selected=true]:border-primary/30 data-[selected=true]:bg-primary/5 data-[selected=true]:text-primary"
                >
                  <Checkbox
                    id={`upload-tag-${tag.id}`}
                    checked={selected}
                    onCheckedChange={() => toggleTag(tag.id)}
                    disabled={uploading}
                  />
                  {tag.name}
                </Label>
              );
            })}
          </div>
        </fieldset>
      )}

      <label className="upload-dropzone mt-6 flex min-h-44 cursor-pointer flex-col items-center justify-center px-6 text-center">
        <ImagePlus className="mb-3 size-6 text-primary" aria-hidden="true" />
        <span className="text-base font-bold">
          {reading ? "날짜를 확인하고 있어요…" : "사진·영상 선택"}
        </span>
        <span className="muted mt-2 text-[15px]">
          JPG, PNG, WebP, MP4 · 한 번에 최대 10개
        </span>
        <input
          className="sr-only"
          name="media"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          multiple
          disabled={reading || uploading}
          onChange={selectMedia}
        />
      </label>

      {mediaItems.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">파일별 정보 확인</h2>
            <span className="muted text-sm">{mediaItems.length}개</span>
          </div>
          {mediaItems.map((media) => (
            <Card
              key={media.id}
              className="rounded-xl p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {contentType(media.file) === "video/mp4" ? (
                  <video
                    src={media.previewUrl}
                    aria-label={`${media.file.name} 미리보기`}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-16 shrink-0 rounded-lg bg-secondary object-cover sm:size-20"
                  />
                ) : (
                  /* Browser object URLs are required here; Next/Image cannot preview local files. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={media.previewUrl}
                    alt=""
                    width={80}
                    height={80}
                    loading="lazy"
                    decoding="async"
                    className="size-16 shrink-0 rounded-lg bg-secondary object-cover sm:size-20"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{media.file.name}</p>
                  <p className="muted mt-1 text-xs">{DATE_SOURCE_LABEL[media.dateSource]} 기준</p>
                  <p className="mt-1 flex items-center gap-1 text-xs font-semibold" aria-live="polite">
                    {media.status === "uploading" && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                    {media.status === "done" && <Check className="size-3.5 text-primary" aria-hidden="true" />}
                    {media.status === "ready" && "업로드 대기"}
                    {media.status === "uploading" && "업로드 중"}
                    {media.status === "done" && "완료"}
                    {media.status === "error" && <span className="text-destructive">실패 · {media.error}</span>}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={uploading || media.status === "done"}
                  onClick={() => removeMedia(media)}
                  aria-label={`${media.file.name} 선택 해제`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <Label className="mt-4 block">
                <span className="sr-only">{media.file.name} 앨범 날짜</span>
                <Input
                  type="date"
                  value={media.albumDate}
                  required
                  disabled={uploading || media.status === "done"}
                  onChange={(event) =>
                    changeDate(media.id, event.target.value)
                  }
                />
              </Label>
              {childTags.length > 0 && (
                <fieldset className="mt-3">
                  <legend className="muted text-xs font-semibold">사진·영상에 나온 아이</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {childTags.map((tag) => {
                      const selected = media.childTagIds.includes(tag.id);
                      return (
                        <Label
                          key={tag.id}
                          htmlFor={`media-${media.id}-tag-${tag.id}`}
                          data-selected={selected}
                          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-sm data-[selected=true]:border-primary/30 data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                        >
                          <Checkbox
                            id={`media-${media.id}-tag-${tag.id}`}
                            checked={selected}
                            disabled={uploading || media.status === "done"}
                            onCheckedChange={() => toggleMediaTag(media.id, tag.id)}
                          />
                          {tag.name}
                        </Label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </Card>
          ))}
          <Button
            className="mt-2 w-full"
            type="button"
            disabled={uploading || mediaItems.some((media) => !media.albumDate) || mediaItems.every((media) => media.status === "done")}
            onClick={upload}
          >
            <Upload aria-hidden="true" />
            {uploading
              ? "파일을 올리고 있어요…"
              : mediaItems.some((media) => media.status === "error")
                ? `실패한 ${mediaItems.filter((media) => media.status === "error").length}개 다시 올리기`
                : `${mediaItems.filter((media) => media.status !== "done").length}개 올리기`}
          </Button>
        </div>
      )}

      {message ? (
        <Alert variant="destructive" className="mt-4" role="status" aria-live="polite">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
