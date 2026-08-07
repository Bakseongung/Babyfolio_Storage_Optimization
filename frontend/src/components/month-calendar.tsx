import Link from "next/link";
import { PrivateImage } from "./private-image";
import {
  mediaFilterPageParams,
  type MediaFilterState
} from "@/lib/media-filter";
import type { CalendarDay } from "@/lib/types";

const weekday = ["일", "월", "화", "수", "목", "금", "토"];

export function MonthCalendar({
  familyId,
  albumId,
  month,
  days,
  filter
}: {
  familyId: string;
  albumId: string;
  month: string;
  days: CalendarDay[];
  filter: MediaFilterState;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const lastDate = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const byDate = new Map(days.map((day) => [day.date, day]));
  const cells = Array.from({ length: firstWeekday + lastDate }, (_, index) => {
    if (index < firstWeekday) return null;
    const day = index - firstWeekday + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return { day, date, data: byDate.get(date) };
  });
  const filterQuery = mediaFilterPageParams(filter).toString();

  return (
    <>
      <div className="calendar calendar-weekdays" aria-hidden="true">
        {weekday.map((name, index) => <span key={name} data-weekday={index}>{name}</span>)}
      </div>
      <div className="calendar">
        {cells.map((cell, index) => cell ? (
          <Link
            key={cell.date}
            className={`day ${cell.data ? "has-media" : ""}`}
            data-weekday={index % 7}
            href={`/families/${familyId}/albums/${albumId}/date/${cell.date}${filterQuery ? `?${filterQuery}` : ""}`}
            aria-label={`${cell.date}, 사진과 영상 ${cell.data?.count ?? 0}개`}
          >
            {cell.data?.representativeMediaId && (
              <PrivateImage mediaId={cell.data.representativeMediaId} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <span className="day-number">{cell.day}</span>
            {cell.data && <span className="day-count">{cell.data.count}개</span>}
          </Link>
        ) : <div key={`empty-${index}`} />)}
      </div>
    </>
  );
}
