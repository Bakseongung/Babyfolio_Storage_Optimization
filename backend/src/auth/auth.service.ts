import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { hash, verify } from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service.js";
import { env } from "../common/env.js";
import type { LoginDto, SignupDto } from "./auth.dto.js";
import { sessionTokenHash } from "./session-token.js";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException({ code: "EMAIL_EXISTS", message: "이미 가입된 이메일입니다." });
    }
    const user = await this.prisma.user.create({
      data: { email, displayName: dto.displayName.trim(), passwordHash: await hash(dto.password) }
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException({ code: "EMAIL_EXISTS", message: "이미 가입된 이메일입니다." });
      }
      throw error;
    });
    return this.createSession(user);
  }

  async login(dto: LoginDto, currentSessionId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    return this.createSession(user, currentSessionId);
  }

  async logout(sessionId?: string): Promise<void> {
    if (sessionId) await this.prisma.session.deleteMany({ where: { id: sessionTokenHash(sessionId) } });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  private async createSession(
    user: { id: string; email: string; displayName: string },
    currentSessionId?: string
  ) {
    const token = randomBytes(32).toString("base64url");
    const id = sessionTokenHash(token);
    const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86_400_000);
    return this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            ...(currentSessionId ? [{ id: sessionTokenHash(currentSessionId) }] : [])
          ]
        }
      });
      await tx.session.create({ data: { id, userId: user.id, expiresAt } });
      return {
        sessionId: token,
        expiresAt,
        user: { id: user.id, email: user.email, displayName: user.displayName }
      };
    });
  }
}
