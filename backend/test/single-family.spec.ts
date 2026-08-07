import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/common/prisma.service.js";
import { FamiliesService } from "../src/families/families.service.js";

describe("single family membership", () => {
  it("does not create a second family for the same user", async () => {
    const create = vi.fn();
    const prisma = {
      familyMember: { findFirst: async () => ({ familyId: "family-1" }) },
      family: { create }
    } as unknown as PrismaService;

    await expect(new FamiliesService(prisma).create("user-1", "새 가족"))
      .rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not accept an invitation to a second family", async () => {
    const transaction = vi.fn();
    const prisma = {
      familyInvite: {
        findUnique: async () => ({
          id: "invite-1",
          familyId: "family-2",
          email: "parent@example.com",
          acceptedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          family: { id: "family-2", name: "다른 가족" }
        })
      },
      user: { findUniqueOrThrow: async () => ({ id: "user-1", email: "parent@example.com" }) },
      familyMember: { findFirst: async () => ({ familyId: "family-1" }) },
      $transaction: transaction
    } as unknown as PrismaService;

    await expect(new FamiliesService(prisma).acceptInvite("user-1", "token"))
      .rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("requires the owner role to rename a family or create an invitation", async () => {
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "MEMBER" })
      },
      family: { update: vi.fn() },
      familyInvite: { create: vi.fn() }
    } as unknown as PrismaService;
    const service = new FamiliesService(prisma);

    await expect(service.update("user-1", "family-1", "새 이름"))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.invite("user-1", "family-1", "guest@example.com"))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not create an invitation for an existing family member", async () => {
    const create = vi.fn();
    const tx = {
      $executeRaw: async () => undefined,
      familyMember: { findFirst: async () => ({ id: "member-1" }) },
      familyInvite: { deleteMany: vi.fn(), create }
    };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "owner-1", role: "OWNER" })
      },
      familyInvite: { create },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;

    await expect(new FamiliesService(prisma).invite("owner-1", "family-1", "MEMBER@example.com"))
      .rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it("invalidates an older pending invitation when issuing a replacement", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const create = vi.fn(async () => ({ id: "invite-2" }));
    const tx = {
      $executeRaw: async () => undefined,
      familyMember: { findFirst: async () => null },
      familyInvite: { deleteMany, create }
    };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "owner-1", role: "OWNER" }),
        findFirst: async () => null
      },
      familyInvite: { create },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;

    await new FamiliesService(prisma).invite("owner-1", "family-1", "GUEST@example.com");

    expect(deleteMany).toHaveBeenCalledWith({
      where: { familyId: "family-1", email: "guest@example.com", acceptedAt: null }
    });
    expect(create).toHaveBeenCalled();
  });

  it("does not reveal invitations that are used or expired", async () => {
    for (const invite of [
      { acceptedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
      { acceptedAt: null, expiresAt: new Date(Date.now() - 1) }
    ]) {
      const prisma = {
        familyInvite: {
          findUnique: async () => ({
            id: "invite-1",
            email: "guest@example.com",
            family: { name: "우리 가족" },
            ...invite
          })
        }
      } as unknown as PrismaService;

      await expect(new FamiliesService(prisma).inviteInfo("token"))
        .rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it("only accepts an invitation for the invited email", async () => {
    const prisma = {
      familyInvite: {
        findUnique: async () => ({
          id: "invite-1",
          familyId: "family-1",
          email: "guest@example.com",
          acceptedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          family: { name: "우리 가족" }
        })
      },
      user: { findUniqueOrThrow: async () => ({ id: "user-1", email: "other@example.com" }) }
    } as unknown as PrismaService;

    await expect(new FamiliesService(prisma).acceptInvite("user-1", "token"))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("consumes every pending invitation for the email when one is accepted", async () => {
    const invite = {
      id: "invite-1",
      familyId: "family-1",
      email: "guest@example.com",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      family: { name: "우리 가족" }
    };
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const executeRaw = vi.fn(async () => undefined);
    const tx = {
      $executeRaw: executeRaw,
      familyInvite: { findUnique: async () => invite, updateMany },
      familyMember: { upsert: async () => ({ id: "member-1" }) }
    };
    const prisma = {
      familyInvite: {
        findUnique: async () => invite,
        update: async () => invite,
        updateMany
      },
      user: { findUniqueOrThrow: async () => ({ id: "user-1", email: invite.email }) },
      familyMember: {
        findFirst: async () => null,
        upsert: async () => ({ id: "member-1" })
      },
      $transaction: async (work: unknown) => typeof work === "function"
        ? (work as (client: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(work as Promise<unknown>[])
    } as unknown as PrismaService;

    await new FamiliesService(prisma).acceptInvite("user-1", "token");

    expect(executeRaw).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: "family-1", email: invite.email, acceptedAt: null },
      data: { acceptedAt: expect.any(Date) }
    });
  });

  it("cannot remove the owner and cannot remove a member from another family", async () => {
    const ownerMembership = { familyId: "family-1", userId: "owner-1", role: "OWNER" };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "member-owner", familyId: "family-1", role: "OWNER" });
    const prisma = {
      familyMember: {
        findUnique: async () => ownerMembership,
        findFirst,
        delete: vi.fn()
      }
    } as unknown as PrismaService;
    const service = new FamiliesService(prisma);

    await expect(service.removeMember("owner-1", "family-1", "other-family-member"))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeMember("owner-1", "family-1", "member-owner"))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps concurrent member removal idempotent and revokes pending invitations", async () => {
    const member = {
      id: "member-1",
      familyId: "family-1",
      role: "MEMBER",
      user: { email: "guest@example.com" }
    };
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const deleteMember = vi.fn(async () => ({ count: 0 }));
    const tx = {
      $executeRaw: async () => undefined,
      familyMember: { deleteMany: deleteMember },
      familyInvite: { deleteMany }
    };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "owner-1", role: "OWNER" }),
        findFirst: async () => member,
        delete: async () => member
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;

    await new FamiliesService(prisma).removeMember("owner-1", "family-1", member.id);

    expect(deleteMember).toHaveBeenCalledWith({ where: { id: member.id, familyId: "family-1" } });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { familyId: "family-1", email: member.user.email, acceptedAt: null }
    });
  });
});
