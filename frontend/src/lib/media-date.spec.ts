import { describe, expect, it } from "vitest";
import { currentAlbumMonth, suggestMediaDate } from "./media-date";

describe("album calendar month", () => {
  it("uses the Korean calendar date instead of UTC", () => {
    expect(currentAlbumMonth(new Date("2026-07-31T15:30:00.000Z"))).toBe("2026-08");
  });
});

describe("media date suggestion", () => {
  it("prefers the original EXIF capture date", () => {
    const original = new Date(2026, 6, 28, 15, 30);
    const created = new Date(2026, 6, 29, 9, 0);

    expect(suggestMediaDate({
      dateTimeOriginal: original,
      createDate: created,
      fileLastModified: new Date(2026, 6, 30, 12, 0),
      today: "2026-07-31"
    })).toEqual({
      albumDate: "2026-07-28",
      capturedAt: original.toISOString(),
      dateSource: "EXIF_ORIGINAL"
    });
  });

  it("keeps a date chosen from the album while preserving capture metadata", () => {
    const original = new Date(2026, 6, 28, 15, 30);

    expect(suggestMediaDate({
      defaultDate: "2026-08-03",
      dateTimeOriginal: original,
      fileLastModified: new Date(2026, 6, 30, 12, 0),
      today: "2026-07-31"
    })).toEqual({
      albumDate: "2026-08-03",
      capturedAt: original.toISOString(),
      dateSource: "USER"
    });
  });

  it("uses EXIF CreateDate when the original capture date is missing", () => {
    const created = new Date(2026, 6, 29, 9, 0);

    expect(suggestMediaDate({
      createDate: created,
      fileLastModified: new Date(2026, 6, 30, 12, 0),
      today: "2026-07-31"
    })).toEqual({
      albumDate: "2026-07-29",
      capturedAt: created.toISOString(),
      dateSource: "EXIF_CREATED"
    });
  });

  it("falls back to the file modification date when EXIF is missing", () => {
    const modified = new Date(2026, 6, 30, 12, 0);

    expect(suggestMediaDate({
      fileLastModified: modified,
      today: "2026-07-31"
    })).toEqual({
      albumDate: "2026-07-30",
      capturedAt: modified.toISOString(),
      dateSource: "FILE_MODIFIED"
    });
  });
});
