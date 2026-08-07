import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { parseMediaFilter } from "../common/media-filter.js";
import { CreateAlbumDto, CreateChildTagDto } from "./albums.dto.js";
import { AlbumsService } from "./albums.service.js";

@Controller()
@UseGuards(SessionGuard)
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get("families/:familyId/albums")
  list(@CurrentUser() user: AuthUser, @Param("familyId") familyId: string) {
    return this.albums.list(user.id, familyId);
  }

  @Post("families/:familyId/albums")
  create(@CurrentUser() user: AuthUser, @Param("familyId") familyId: string, @Body() dto: CreateAlbumDto) {
    return this.albums.create(user.id, familyId, dto);
  }

  @Post("albums/:albumId/child-tags")
  createChildTag(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Body() dto: CreateChildTagDto
  ) {
    return this.albums.createChildTag(user.id, albumId, dto.name);
  }

  @Delete("albums/:albumId/child-tags/:tagId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteChildTag(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Param("tagId") tagId: string
  ) {
    return this.albums.deleteChildTag(user.id, albumId, tagId);
  }

  @Get("albums/:albumId/calendar")
  calendar(
    @CurrentUser() user: AuthUser,
    @Param("albumId") albumId: string,
    @Query("month") month: string,
    @Query("childTagId") childTagId?: string,
    @Query("childTagIds") childTagIds?: string,
    @Query("match") match?: string,
    @Query("untagged") untagged?: string
  ) {
    return this.albums.calendar(
      user.id,
      albumId,
      month,
      parseMediaFilter({ childTagId, childTagIds, match, untagged })
    );
  }
}
