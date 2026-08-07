import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FamilyRole } from "../generated/prisma/enums.js";
import { PrismaService } from "../common/prisma.service.js";

@Injectable()
export class FamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.family.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { where: { userId }, select: { role: true } },
        albums: { include: { childTags: { orderBy: { createdAt: "asc" } } } }
      },
      orderBy: { createdAt: "asc" }
    });
  }

  async create(userId: string, name: string) {
    if (await this.prisma.familyMember.findFirst({ where: { userId } })) {
      throw new ConflictException({ code: "FAMILY_ALREADY_JOINED", message: "이미 가족에 참여하고 있습니다." });
    }
    return this.prisma.family.create({
      data: {
        name: name.trim(),
        members: { create: { userId, role: "OWNER" } }
      }
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException({ code: "FAMILY_ALREADY_JOINED", message: "이미 가족에 참여하고 있습니다." });
      }
      throw error;
    });
  }

  async update(userId: string, familyId: string, name: string) {
    await this.requireMembership(userId, familyId, "OWNER");
    return this.prisma.family.update({ where: { id: familyId }, data: { name: name.trim() } });
  }

  async members(userId: string, familyId: string) {
    await this.requireMembership(userId, familyId);
    return this.prisma.familyMember.findMany({
      where: { familyId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true } }
      }
    });
  }

  async invite(userId: string, familyId: string, email: string) {
    await this.requireMembership(userId, familyId, "OWNER");
    const normalizedEmail = email.trim().toLowerCase();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      const lockKey = `invite:${familyId}:${normalizedEmail}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existingMember = await tx.familyMember.findFirst({
        where: { familyId, user: { email: normalizedEmail } }
      });
      if (existingMember) {
        throw new ConflictException({ code: "MEMBER_ALREADY_JOINED", message: "이미 가족에 참여한 계정입니다." });
      }
      await tx.familyInvite.deleteMany({
        where: { familyId, email: normalizedEmail, acceptedAt: null }
      });
      await tx.familyInvite.create({
        data: {
          familyId,
          createdById: userId,
          email: normalizedEmail,
          tokenHash: this.tokenHash(token),
          expiresAt
        }
      });
    });
    return { token, expiresAt };
  }

  async inviteInfo(token: string) {
    const invite = await this.findInvite(token);
    return { familyName: invite.family.name, email: invite.email, expiresAt: invite.expiresAt };
  }

  async acceptInvite(userId: string, token: string) {
    const invite = await this.findInvite(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== invite.email) {
      throw new ForbiddenException({ code: "INVITE_EMAIL_MISMATCH", message: "초대받은 이메일 계정으로 로그인해 주세요." });
    }
    const membership = await this.prisma.familyMember.findFirst({ where: { userId } });
    if (membership && membership.familyId !== invite.familyId) {
      throw new ConflictException({ code: "FAMILY_ALREADY_JOINED", message: "이미 다른 가족에 참여하고 있습니다." });
    }
    await this.prisma.$transaction(async (tx) => {
      const lockKey = `invite:${invite.familyId}:${invite.email}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const currentInvite = await tx.familyInvite.findUnique({ where: { id: invite.id } });
      if (!currentInvite || currentInvite.acceptedAt || currentInvite.expiresAt <= new Date()) {
        throw new NotFoundException({ code: "INVITE_NOT_FOUND", message: "초대가 없거나 만료되었습니다." });
      }
      await tx.familyMember.upsert({
        where: { familyId_userId: { familyId: invite.familyId, userId } },
        update: {},
        create: { familyId: invite.familyId, userId, role: "MEMBER" }
      });
      await tx.familyInvite.updateMany({
        where: { familyId: invite.familyId, email: invite.email, acceptedAt: null },
        data: { acceptedAt: new Date() }
      });
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException({ code: "FAMILY_ALREADY_JOINED", message: "이미 다른 가족에 참여하고 있습니다." });
      }
      throw error;
    });
    return { familyId: invite.familyId };
  }

  async removeMember(userId: string, familyId: string, memberId: string) {
    await this.requireMembership(userId, familyId, "OWNER");
    const member = await this.prisma.familyMember.findFirst({
      where: { id: memberId, familyId },
      include: { user: { select: { email: true } } }
    });
    if (!member) throw new NotFoundException({ code: "MEMBER_NOT_FOUND", message: "구성원을 찾을 수 없습니다." });
    if (member.role === "OWNER") {
      throw new BadRequestException({ code: "OWNER_CANNOT_BE_REMOVED", message: "가족 대표는 내보낼 수 없습니다." });
    }
    await this.prisma.$transaction(async (tx) => {
      const lockKey = `invite:${familyId}:${member.user.email}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      await tx.familyMember.deleteMany({ where: { id: member.id, familyId } });
      await tx.familyInvite.deleteMany({
        where: { familyId, email: member.user.email, acceptedAt: null }
      });
    });
    return { ok: true };
  }

  async requireMembership(userId: string, familyId: string, role?: FamilyRole) {
    const membership = await this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId } }
    });
    if (!membership) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "가족을 찾을 수 없습니다." });
    if (role && membership.role !== role) {
      throw new ForbiddenException({ code: "OWNER_REQUIRED", message: "가족 대표만 할 수 있습니다." });
    }
    return membership;
  }

  private async findInvite(token: string) {
    const invite = await this.prisma.familyInvite.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { family: true }
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      throw new NotFoundException({ code: "INVITE_NOT_FOUND", message: "초대가 없거나 만료되었습니다." });
    }
    return invite;
  }

  private tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
