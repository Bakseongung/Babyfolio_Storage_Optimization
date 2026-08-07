import Link from "next/link";
import { CalendarDays, Check, ChevronDown, Images, Plus, Settings, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  mediaFilterPageParams,
  type MediaFilterState
} from "@/lib/media-filter";
import type { Album, Family } from "@/lib/types";
import { LinkPendingIndicator } from "./link-pending-indicator";

export function AlbumBrowserHeader({
  family,
  album,
  month,
  filter,
  activeView
}: {
  family: Family;
  album: Album;
  month: string;
  filter: MediaFilterState;
  activeView: "calendar" | "media";
}) {
  const calendarQuery = mediaFilterPageParams(filter, { month }).toString();
  const mediaQuery = mediaFilterPageParams(filter).toString();
  const isOwner = family.members[0]?.role === "OWNER";

  return (
    <div className="album-hero">
      <div className="album-heading">
        <div className="album-title-row">
          <DropdownMenu>
            <h1 className="min-w-0">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="album-title-trigger"
                  aria-label={`앨범 전환. 현재 앨범 ${album.name}`}
                >
                  <span className="brand">{album.name}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
            </h1>
            <DropdownMenuContent
              align="start"
              className="w-max min-w-56 max-w-[calc(100vw-2rem)] sm:max-w-sm"
            >
              <DropdownMenuLabel>앨범</DropdownMenuLabel>
              {family.albums.map((item) => (
                <DropdownMenuItem key={item.id} asChild>
                  <Link
                    href={`/families/${family.id}/albums/${item.id}/calendar?month=${month}`}
                    aria-current={item.id === album.id ? "page" : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.id === album.id ? <Check className="size-4" aria-hidden="true" /> : null}
                  </Link>
                </DropdownMenuItem>
              ))}
              {isOwner ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={`/families/${family.id}/albums/new`}>
                      <Plus aria-hidden="true" />
                      새 앨범
                    </Link>
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!album.childTags.length ? (
          <p className="muted mt-2 text-sm">
            {isOwner
              ? "앨범 설정에서 아이 이름을 추가할 수 있어요."
              : "앨범을 만든 사람이 아이 이름을 추가할 수 있어요."}
          </p>
        ) : null}
      </div>

      <div className="album-actions">
        <nav className="album-view-nav" aria-label="앨범 보기 방식">
          <Button asChild variant="ghost" size="sm" className="album-view-control" data-active={activeView === "calendar"}>
            <Link
              href={`/families/${family.id}/albums/${album.id}/calendar?${calendarQuery}`}
              aria-current={activeView === "calendar" ? "page" : undefined}
            >
              <CalendarDays aria-hidden="true" />
              달력
              <LinkPendingIndicator />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="album-view-control" data-active={activeView === "media"}>
            <Link
              href={`/families/${family.id}/albums/${album.id}/media${mediaQuery ? `?${mediaQuery}` : ""}`}
              aria-current={activeView === "media" ? "page" : undefined}
            >
              <Images aria-hidden="true" />
              모아보기
              <LinkPendingIndicator />
            </Link>
          </Button>
        </nav>
        {isOwner ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/families/${family.id}/albums/${album.id}/settings`}>
              <Settings aria-hidden="true" />
              앨범 설정
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm">
          <Link href={`/families/${family.id}/albums/${album.id}/upload`}>
            <Upload aria-hidden="true" />
            사진·영상 올리기
          </Link>
        </Button>
      </div>
    </div>
  );
}
