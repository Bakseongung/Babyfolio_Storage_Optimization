import Link from "next/link";
import { ArrowLeft, ImagePlus } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ChildTagFilter } from "@/components/child-tag-filter";
import { MediaGallery } from "@/components/media-gallery";
import { Button } from "@/components/ui/button";
import {
  parseMediaFilter,
  mediaFilterApiParams,
  mediaFilterKey,
  mediaFilterPageParams
} from "@/lib/media-filter";
import { currentUser } from "@/lib/current-user";
import { protectedApi } from "@/lib/protected-api";
import type { Family, Media } from "@/lib/types";

export default async function DatePage({
  params,
  searchParams
}: {
  params: Promise<{ familyId: string; albumId: string; date: string }>;
  searchParams: Promise<{
    tag?: string;
    tags?: string;
    match?: string;
    untagged?: string;
  }>;
}) {
  const { familyId, albumId, date } = await params;
  const filter = parseMediaFilter(await searchParams);
  const apiQuery = mediaFilterApiParams(filter, { date });
  const pageQuery = mediaFilterPageParams(filter).toString();
  const returnTo = `/families/${familyId}/albums/${albumId}/date/${date}${pageQuery ? `?${pageQuery}` : ""}`;
  const [mediaItems, families, user] = await Promise.all([
    protectedApi<Media[]>(`/albums/${albumId}/media?${apiQuery}`, returnTo),
    protectedApi<Family[]>("/families", returnTo),
    currentUser()
  ]);
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  const family = families.find((item) => item.id === familyId);
  const album = family?.albums.find((item) => item.id === albumId);
  if (!family || !album) notFound();
  const selectedNames = album.childTags
    .filter((tag) => filter.childTagIds.includes(tag.id))
    .map((tag) => tag.name);
  const filterLabel = filter.untagged
    ? "태그 없는"
    : selectedNames.length > 1
      ? filter.match === "all"
        ? `${selectedNames.join("·")}가 함께 나온`
        : `${selectedNames.join("·")} 중 한 명이라도 나온`
      : selectedNames[0];
  const month = date.slice(0, 7);
  const uploadHref = `/families/${familyId}/albums/${albumId}/upload?date=${date}`;
  const calendarParams = mediaFilterPageParams(filter, { month });
  const dateValue = new Date(`${date}T00:00:00+09:00`);
  const yearLabel = new Intl.DateTimeFormat("ko-KR", { year: "numeric" }).format(dateValue);
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric"
  }).format(dateValue);
  const weekdayLabel = new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(dateValue);
  return (
    <section>
      <div className="date-page-header">
        <div>
          <Button asChild variant="link" className="page-back">
            <Link href={`/families/${familyId}/albums/${albumId}/calendar?${calendarParams}`}>
              <ArrowLeft aria-hidden="true" />
              달력으로 돌아가기
            </Link>
          </Button>
          <p className="date-year">{yearLabel}</p>
          <div className="date-title-row">
            <h1 className="brand text-4xl font-extrabold sm:text-5xl">
              <time dateTime={date}>{dateLabel}</time>
            </h1>
            <span className="weekday-badge">{weekdayLabel}</span>
          </div>
          <p className="date-media-count">{filterLabel ? `${filterLabel} 기록 ` : "사진·영상 "}<strong>{mediaItems.length}개</strong></p>
        </div>
        <Button asChild>
          <Link href={uploadHref}>
            <ImagePlus aria-hidden="true" />
            사진·영상 추가
          </Link>
        </Button>
      </div>
      <ChildTagFilter
        baseHref={`/families/${familyId}/albums/${albumId}/date/${date}`}
        childTags={album.childTags}
        filter={filter}
      />
      <MediaGallery
        key={mediaFilterKey(filter)}
        mediaItems={mediaItems}
        currentUserId={user.id}
        canDeleteAll={family.members[0]?.role === "OWNER"}
        uploadHref={uploadHref}
        emptyTitle={filterLabel ? `${filterLabel} 기록이 아직 없습니다` : undefined}
        emptyDescription={filterLabel ? "다른 필터를 선택하거나 새 사진·영상을 추가해 보세요." : undefined}
      />
    </section>
  );
}
