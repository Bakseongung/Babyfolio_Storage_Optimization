import { ConflictException, HttpException, HttpStatus } from "@nestjs/common";
import type { FamilyRole } from "../generated/prisma/enums.js";

export function assertDailyMediaCapacity(activeCount: number): void {
  if (activeCount >= 10) {
    throw new ConflictException({
      code: "DAILY_MEDIA_LIMIT",
      message: "사진과 영상을 합쳐 하루 최대 10개까지 올릴 수 있습니다."
    });
  }
}

export function assertActiveUploadCapacity(activeCount: number, maximum: number): void {
  if (activeCount >= maximum) {
    throw new HttpException({
      code: "UPLOAD_CONCURRENCY_LIMIT",
      message: `동시에 최대 ${maximum}개의 파일만 업로드할 수 있습니다.`
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function canDeleteMedia(
  role: FamilyRole,
  currentUserId: string,
  uploadedById: string
): boolean {
  return role === "OWNER" || currentUserId === uploadedById;
}
