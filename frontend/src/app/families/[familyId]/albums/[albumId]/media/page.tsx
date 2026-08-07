import { notFound, redirect } from "next/navigation";
import { AlbumBrowserHeader } from "@/components/album-browser-header";
import { ChildTagFilter } from "@/components/child-tag-filter";
import { MediaFeed } from "@/components/media-feed";
import {
  parseMediaFilter,
  mediaFilterApiParams,
  mediaFilterKey,
  mediaFilterPageParams
} from "@/lib/media-filter";
import { currentAlbumMonth } from "@/lib/media-date";
import { currentUser } from "@/lib/current-user";
import { protectedApi } from "@/lib/protected-api";
import type { Family, MediaFeedPage } from "@/lib/types";

export default async function MediaPage({
  params,
  searchParams
}: {
  params: Promise<{ familyId: string; albumId: string }>;
  searchParams: Promise<{
    tag?: string;
    tags?: string;
    match?: string;
    untagged?: string;
  }>;
}) {
  const { familyId, albumId } = await params;
  const filter = parseMediaFilter(await searchParams);
  const apiQuery = mediaFilterApiParams(filter, { take: "40" });
  const feedPath = `/albums/${albumId}/media-feed?${apiQuery}`;
  const pageQuery = mediaFilterPageParams(filter).toString();
  const returnTo = `/families/${familyId}/albums/${albumId}/media${pageQuery ? `?${pageQuery}` : ""}`;
  const [initialPage, families, user] = await Promise.all([
    protectedApi<MediaFeedPage>(feedPath, returnTo),
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
  const emptyTitle = filter.untagged
    ? "태그 없는 기록이 없습니다"
    : selectedNames.length > 1
      ? filter.match === "all"
        ? `${selectedNames.join("·")}가 함께 나온 기록이 없습니다`
        : `${selectedNames.join("·")} 중 선택한 아이가 나온 기록이 없습니다`
      : selectedNames.length === 1
        ? `${selectedNames[0]} 기록이 없습니다`
        : "아직 앨범에 사진이나 영상이 없습니다";
  const month = currentAlbumMonth();

  return (
    <section>
      <AlbumBrowserHeader
        family={family}
        album={album}
        month={month}
        filter={filter}
        activeView="media"
      />
      <ChildTagFilter
        baseHref={`/families/${familyId}/albums/${albumId}/media`}
        childTags={album.childTags}
        filter={filter}
      />
      <MediaFeed
        key={`${albumId}:${mediaFilterKey(filter)}`}
        initialPage={initialPage}
        feedPath={feedPath}
        currentUserId={user.id}
        canDeleteAll={family.members[0]?.role === "OWNER"}
        uploadHref={`/families/${familyId}/albums/${albumId}/upload`}
        emptyTitle={emptyTitle}
      />
    </section>
  );
}
