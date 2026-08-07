import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { parseMediaFilter } from "../common/media-filter.js";
import { MediaService } from "./media.service.js";
import { RepresentativeDto, StartUploadDto } from "./media.dto.js";

@Controller()
@UseGuards(SessionGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("albums/:albumId/uploads")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Param("albumId") albumId: string, @Body() dto: StartUploadDto) {
    return this.mediaService.startUpload(user.id, albumId, dto);
  }

  @Post("media/:mediaId/complete")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  complete(@CurrentUser() user: AuthUser, @Param("mediaId") mediaId: string) {
    return this.mediaService.queueCompletion(user.id, mediaId);
  }

  @Get("media/:mediaId/status")
  status(@CurrentUser() user: AuthUser, @Param("mediaId") mediaId: string) {
    return this.mediaService.status(user.id, mediaId);
  }

  @Get("albums/:albumId/media")
  list(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Query("date") date: string,
    @Query("childTagId") childTagId?: string,
    @Query("childTagIds") childTagIds?: string,
    @Query("match") match?: string,
    @Query("untagged") untagged?: string
  ) {
    return this.mediaService.list(
      user.id,
      albumId,
      date,
      parseMediaFilter({ childTagId, childTagIds, match, untagged })
    );
  }

  @Get("albums/:albumId/media-feed")
  feed(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Query("childTagId") childTagId?: string,
    @Query("childTagIds") childTagIds?: string,
    @Query("match") match?: string,
    @Query("untagged") untagged?: string,
    @Query("cursor") cursor?: string,
    @Query("take") take?: string
  ) {
    return this.mediaService.feed(
      user.id,
      albumId,
      parseMediaFilter({ childTagId, childTagIds, match, untagged }),
      cursor,
      take ? Number(take) : undefined
    );
  }

  @Get("media/:mediaId/url")
  url(
    @CurrentUser() user: AuthUser,
    @Param("mediaId") mediaId: string,
    @Query("variant") variant: "thumbnail" | "display" | "original" = "display"
  ) {
    return this.mediaService.url(user.id, mediaId, variant);
  }

  @Put("albums/:albumId/dates/:date/representative")
  representative(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Param("date") date: string,
    @Body() dto: RepresentativeDto
  ) {
    return this.mediaService.setRepresentative(user.id, albumId, date, dto.mediaId);
  }

  @Delete("media/:mediaId")
  remove(@CurrentUser() user: AuthUser, @Param("mediaId") mediaId: string) {
    return this.mediaService.remove(user.id, mediaId);
  }
}
