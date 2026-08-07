import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { env } from "../common/env.js";
import { AuthService } from "./auth.service.js";
import { LoginDto, SignupDto } from "./auth.dto.js";
import { SessionGuard } from "./session.guard.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { AuthUser } from "./auth.types.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.signup(dto);
    this.setCookie(response, result.sessionId, result.expiresAt);
    return { user: result.user };
  }

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const currentSessionId = request.cookies?.[env.sessionCookieName] as string | undefined;
    const result = await this.auth.login(dto, currentSessionId);
    this.setCookie(response, result.sessionId, result.expiresAt);
    return { user: result.user };
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[env.sessionCookieName] as string | undefined);
    response.clearCookie(env.sessionCookieName, { path: "/" });
    return { ok: true };
  }

  @Post("logout-all")
  @UseGuards(SessionGuard)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutAll(user.id);
    response.clearCookie(env.sessionCookieName, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  private setCookie(response: Response, value: string, expires: Date): void {
    response.cookie(env.sessionCookieName, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires,
      path: "/"
    });
  }
}
