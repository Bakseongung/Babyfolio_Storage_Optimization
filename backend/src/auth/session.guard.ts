import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../common/prisma.service.js";
import { env } from "../common/env.js";
import type { AuthUser } from "./auth.types.js";
import { sessionTokenHash } from "./session-token.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>() as Request & { user: AuthUser };
    const sessionId = request.cookies?.[env.sessionCookieName] as string | undefined;
    if (!sessionId) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "로그인이 필요합니다." });

    const session = await this.prisma.session.findFirst({
      where: { id: sessionTokenHash(sessionId), expiresAt: { gt: new Date() } },
      include: { user: true }
    });
    if (!session) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "세션이 만료되었습니다." });

    request.user = {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName
    };
    return true;
  }
}
