import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlbumsController } from "../src/albums/albums.controller.js";
import { AlbumsService } from "../src/albums/albums.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { FamiliesService } from "../src/families/families.service.js";

async function createChildTagTestApp(prisma: object, userId = "user-1") {
  const moduleRef = await Test.createTestingModule({
    controllers: [AlbumsController],
    providers: [
      AlbumsService,
      FamiliesService,
      { provide: PrismaService, useValue: prisma }
    ]
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: { switchToHttp(): { getRequest(): { user?: unknown } } }) {
        context.switchToHttp().getRequest().user = {
          id: userId,
          email: "parent@example.com",
          displayName: "부모"
        };
        return true;
      }
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe("child tag API", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("creates an album with its initial child tags", async () => {
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        create: async ({ data }: { data: { familyId: string; name: string; childTags?: { createMany: { data: { name: string }[] } } } }) => ({
          id: "album-1",
          familyId: data.familyId,
          name: data.name,
          childTags: data.childTags?.createMany.data.map((tag, index) => ({
            id: `tag-${index + 1}`,
            name: tag.name
          })) ?? []
        })
      }
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [
        AlbumsService,
        FamiliesService,
        { provide: PrismaService, useValue: prisma }
      ]
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate(context: { switchToHttp(): { getRequest(): { user?: unknown } } }) {
          context.switchToHttp().getRequest().user = {
            id: "user-1",
            email: "parent@example.com",
            displayName: "부모"
          };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/families/family-1/albums")
      .send({ name: "우리의 여름", childNames: ["민서", "준서"] })
      .expect(201);

    expect(response.body).toMatchObject({
      id: "album-1",
      name: "우리의 여름",
      childTags: [{ name: "민서" }, { name: "준서" }]
    });
  });

  it("adds a child tag to an existing album", async () => {
    const childTag = {
      count: async () => 2,
      create: async ({ data }: { data: { albumId: string; name: string } }) => ({
        id: "tag-3",
        albumId: data.albumId,
        name: data.name
      })
    };
    const tx = { $executeRaw: async () => undefined, childTag };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag,
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [
        AlbumsService,
        FamiliesService,
        { provide: PrismaService, useValue: prisma }
      ]
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate(context: { switchToHttp(): { getRequest(): { user?: unknown } } }) {
          context.switchToHttp().getRequest().user = {
            id: "user-1",
            email: "parent@example.com",
            displayName: "부모"
          };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/child-tags")
      .send({ name: "하린" })
      .expect(201);

    expect(response.body).toMatchObject({
      id: "tag-3",
      albumId: "album-1",
      name: "하린"
    });
  });

  it("returns a conflict when another request creates the same child tag first", async () => {
    const childTag = {
      count: async () => 1,
      create: async () => Promise.reject({ code: "P2002" })
    };
    const tx = { $executeRaw: async () => undefined, childTag };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag,
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [
        AlbumsService,
        FamiliesService,
        { provide: PrismaService, useValue: prisma }
      ]
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate(context: { switchToHttp(): { getRequest(): { user?: unknown } } }) {
          context.switchToHttp().getRequest().user = {
            id: "user-1",
            email: "parent@example.com",
            displayName: "부모"
          };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/child-tags")
      .send({ name: "민서" })
      .expect(409);

    expect(response.body).toMatchObject({ code: "CHILD_TAG_EXISTS" });
  });

  it("rejects more than ten child tags in an album", async () => {
    const create = vi.fn();
    const tx = {
      $executeRaw: async () => undefined,
      childTag: { count: async () => 10, create }
    };
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag: { create },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    };
    app = await createChildTagTestApp(prisma);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/child-tags")
      .send({ name: "열한째" })
      .expect(409);

    expect(response.body).toMatchObject({ code: "CHILD_TAG_LIMIT" });
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes an owned album child tag without deleting a media", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const mediaDelete = vi.fn();
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag: { deleteMany },
      media: { delete: mediaDelete }
    };
    app = await createChildTagTestApp(prisma);

    await request(app.getHttpServer())
      .delete("/albums/album-1/child-tags/tag-1")
      .expect(204);

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "tag-1", albumId: "album-1" } });
    expect(mediaDelete).not.toHaveBeenCalled();
  });

  it("does not reveal a missing tag or a tag from another album", async () => {
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag: { deleteMany: async () => ({ count: 0 }) }
    };
    app = await createChildTagTestApp(prisma);

    const response = await request(app.getHttpServer())
      .delete("/albums/album-1/child-tags/tag-from-another-album")
      .expect(404);

    expect(response.body).toMatchObject({ code: "CHILD_TAG_NOT_FOUND" });
  });

  it("does not reveal an album from another family", async () => {
    const deleteMany = vi.fn();
    const prisma = {
      familyMember: { findUnique: async () => null },
      album: {
        findUnique: async () => ({ id: "album-2", familyId: "family-2", name: "다른 가족 앨범" })
      },
      childTag: { deleteMany }
    };
    app = await createChildTagTestApp(prisma);

    const response = await request(app.getHttpServer())
      .delete("/albums/album-2/child-tags/tag-2")
      .expect(404);

    expect(response.body).toMatchObject({ code: "CHILD_TAG_NOT_FOUND" });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("requires the family owner to delete a child tag", async () => {
    const deleteMany = vi.fn();
    const prisma = {
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "MEMBER" })
      },
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      childTag: { deleteMany }
    };
    app = await createChildTagTestApp(prisma);

    const response = await request(app.getHttpServer())
      .delete("/albums/album-1/child-tags/tag-1")
      .expect(403);

    expect(response.body).toMatchObject({ code: "OWNER_REQUIRED" });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
