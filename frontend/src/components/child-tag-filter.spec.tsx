import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChildTagFilter } from "./child-tag-filter";
import { MonthCalendar } from "./month-calendar";
import { mediaFilterPageParams } from "@/lib/media-filter";

const childTags = [
  { id: "tag-1", albumId: "album-1", name: "민서" },
  { id: "tag-2", albumId: "album-1", name: "준서" }
];

describe("child tag media filter", () => {
  it("summarizes multiple children and builds their filter URLs", () => {
    const markup = renderToStaticMarkup(
      <ChildTagFilter
        baseHref="/families/family-1/albums/album-1/calendar"
        childTags={childTags}
        filter={{
          childTagIds: ["tag-1", "tag-2"],
          match: "all",
          untagged: false
        }}
        searchParams={{ month: "2026-07" }}
      />
    );

    expect(markup).toContain("한 명 이상");
    expect(markup).toContain("모두 포함");
    expect(markup).toContain("tags=tag-1%2Ctag-2&amp;match=all");
    expect(markup).toContain("month=2026-07&amp;tags=tag-2");
    expect(markup).toContain("민서 기록, 선택됨");
    expect(markup).toContain("준서 기록, 선택됨");
    expect(markup).toContain('href="/families/family-1/albums/album-1/calendar?month=2026-07"');
    expect(mediaFilterPageParams(
      { childTagIds: ["tag-2"], match: "any", untagged: false },
      { month: "2026-07" }
    ).toString()).toBe("month=2026-07&tags=tag-2");
    expect(mediaFilterPageParams(
      { childTagIds: ["tag-1", "tag-2"], match: "all", untagged: false },
      { month: "2026-07" }
    ).toString()).toBe("month=2026-07&tags=tag-1%2Ctag-2&match=all");
  });

  it("keeps the complete filter when opening a date from the calendar", () => {
    const markup = renderToStaticMarkup(
      <MonthCalendar
        familyId="family-1"
        albumId="album-1"
        month="2026-07"
        days={[]}
        filter={{
          childTagIds: ["tag-1", "tag-2"],
          match: "all",
          untagged: false
        }}
      />
    );

    expect(markup).toContain(
      "/date/2026-07-01?tags=tag-1%2Ctag-2&amp;match=all"
    );
  });
});
