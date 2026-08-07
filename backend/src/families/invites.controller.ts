import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { FamiliesService } from "./families.service.js";

@Controller("invites")
export class InvitesController {
  constructor(private readonly families: FamiliesService) {}

  @Get(":token")
  info(@Param("token") token: string) {
    return this.families.inviteInfo(token);
  }

  @Post(":token/accept")
  @UseGuards(SessionGuard)
  accept(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.families.acceptInvite(user.id, token);
  }
}
