import { notFound } from "next/navigation";
import { AlbumBrowserHeader } from "@/components/album-browser-header";
import { ChildTagFilter } from "@/components/child-tag-filter";
import { MonthNavigator } from "@/components/month-navigator";
import { MonthCalendar } from "@/components/month-calendar";
import { Card } from "@/components/ui/card";
import {
  parseMediaFilter,
  mediaFilterApiParams,
  mediaFilterPageParams
} from "@/lib/media-filter";
import { currentAlbumMonth } from "@/lib/media-date";
import { protectedApi } from "@/lib/protected-api";
import type { CalendarDay, Family } from "@/lib/types";

export default async function CalendarPage({
  params,
  searchParams
}: {
  params: Promise<{ familyId: string; albumId: string }>;
  searchParams: Promise<{
    month?: string;
    tag?: string;
    tags?: string;
    match?: string;
    untagged?: string;
  }>;
}) {
  const { familyId, albumId } = await params;
  const query = await searchParams;
  const month = query.month ?? currentAlbumMonth();
  const filter = parseMediaFilter(query);
  const apiQuery = mediaFilterApiParams(filter, { month });
  const returnTo = `/families/${familyId}/albums/${albumId}/calendar?${mediaFilterPageParams(filter, { month })}`;
  const [days, families] = await Promise.all([
    protectedApi<CalendarDay[]>(`/albums/${albumId}/calendar?${apiQuery}`, returnTo),
    protectedApi<Family[]>("/families", returnTo)
  ]);
  const family = families.find((item) => item.id === familyId);
  const album = family?.albums.find((item) => item.id === albumId);
  if (!family || !album) notFound();
  const current = new Date(`${month}-01T00:00:00Z`);
  const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  const filterQuery = mediaFilterPageParams(filter).toString();

  return (
    <section>
      <AlbumBrowserHeader
        family={family}
        album={album}
        month={month}
        filter={filter}
        activeView="calendar"
      />
      <ChildTagFilter
        baseHref={`/families/${familyId}/albums/${albumId}/calendar`}
        childTags={album.childTags}
        filter={filter}
        searchParams={{ month }}
      />
      <Card className="calendar-frame">
        <MonthNavigator
          baseHref={`/families/${familyId}/albums/${albumId}/calendar`}
          month={month}
          previous={previous}
          next={next}
          today={currentAlbumMonth()}
          filterQuery={filterQuery}
        />
        <MonthCalendar
          familyId={familyId}
          albumId={albumId}
          month={month}
          days={days}
          filter={filter}
        />
      </Card>
    </section>
  );
}
