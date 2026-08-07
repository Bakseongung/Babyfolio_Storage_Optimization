import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { CreateFamilyDto, CreateInviteDto, UpdateFamilyDto } from "./families.dto.js";
import { FamiliesService } from "./families.service.js";

@Controller("families")
@UseGuards(SessionGuard)
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.families.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFamilyDto) {
    return this.families.create(user.id, dto.name);
  }

  @Patch(":familyId")
  update(@CurrentUser() user: AuthUser, @Param("familyId") familyId: string, @Body() dto: UpdateFamilyDto) {
    return this.families.update(user.id, familyId, dto.name);
  }

  @Get(":familyId/members")
  members(@CurrentUser() user: AuthUser, @Param("familyId") familyId: string) {
    return this.families.members(user.id, familyId);
  }

  @Post(":familyId/invites")
  invite(@CurrentUser() user: AuthUser, @Param("familyId") familyId: string, @Body() dto: CreateInviteDto) {
    return this.families.invite(user.id, familyId, dto.email);
  }

  @Delete(":familyId/members/:memberId")
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param("familyId") familyId: string,
    @Param("memberId") memberId: string
  ) {
    return this.families.removeMember(user.id, familyId, memberId);
  }
}
