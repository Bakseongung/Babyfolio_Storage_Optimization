export type MediaDateSource =
  | "EXIF_ORIGINAL"
  | "EXIF_CREATED"
  | "FILE_MODIFIED"
  | "USER"
  | "DEFAULT";

export type MediaDateSuggestion = {
  albumDate: string;
  capturedAt: string | null;
  dateSource: MediaDateSource;
};

type MediaDateInput = {
  defaultDate?: string;
  dateTimeOriginal?: Date;
  createDate?: Date;
  fileLastModified?: Date;
  today: string;
};

function isValidDate(value?: Date): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentAlbumMonth(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function suggestMediaDate(input: MediaDateInput): MediaDateSuggestion {
  const exif = isValidDate(input.dateTimeOriginal)
    ? { date: input.dateTimeOriginal, source: "EXIF_ORIGINAL" as const }
    : isValidDate(input.createDate)
      ? { date: input.createDate, source: "EXIF_CREATED" as const }
      : null;

  if (input.defaultDate) {
    return {
      albumDate: input.defaultDate,
      capturedAt: exif?.date.toISOString() ?? null,
      dateSource: "USER"
    };
  }
  if (exif) {
    return {
      albumDate: localDate(exif.date),
      capturedAt: exif.date.toISOString(),
      dateSource: exif.source
    };
  }
  if (isValidDate(input.fileLastModified)) {
    return {
      albumDate: localDate(input.fileLastModified),
      capturedAt: input.fileLastModified.toISOString(),
      dateSource: "FILE_MODIFIED"
    };
  }
  return { albumDate: input.today, capturedAt: null, dateSource: "DEFAULT" };
}
