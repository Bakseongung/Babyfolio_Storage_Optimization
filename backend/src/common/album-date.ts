import { BadRequestException } from "@nestjs/common";

export function parseAlbumDate(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(Number.NaN);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException({
      code: "INVALID_DATE",
      message: "날짜가 올바르지 않습니다."
    });
  }
  return date;
}

export function parseAlbumMonth(value: string): Date {
  const month = /^\d{4}-\d{2}$/.test(value)
    ? new Date(`${value}-01T00:00:00.000Z`)
    : new Date(Number.NaN);
  if (Number.isNaN(month.valueOf()) || month.toISOString().slice(0, 7) !== value) {
    throw new BadRequestException({
      code: "INVALID_MONTH",
      message: "월이 올바르지 않습니다."
    });
  }
  return month;
}
