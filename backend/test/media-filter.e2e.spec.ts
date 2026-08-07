import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AlbumsController } from "../src/albums/albums.controller.js";
import { AlbumsService } from "../src/albums/albums.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { FamiliesService } from "../src/families/families.service.js";
import { MediaController } from "../src/media/media.controller.js";
import { MediaService } from "../src/media/media.service.js";
import { StorageService } from "../src/media/storage.service.js";

const tags = {
  minseo: { id: "tag-1", albumId: "album-1", name: "민서" },
  junseo: { id: "tag-2", albumId: "album-1", name: "준서" }
};

const mediaItems = [
  {
    id: "media-minseo",
    albumId: "album-1",
    albumDate: new Date("2026-07-02T00:00:00.000Z"),
    originalName: "minseo.jpg",
    uploadedById: "user-1",
    createdAt: new Date("2026-07-02T09:00:00.000Z"),
    mediaAsset: { width: 1200, height: 800 },
    childTags: [{ childTag: tags.minseo }]
  },
  {
    id: "media-junseo",
    albumId: "album-1",
    albumDate: new Date("2026-07-02T00:00:00.000Z"),
    originalName: "junseo.jpg",
    uploadedById: "user-1",
    createdAt: new Date("2026-07-02T10:00:00.000Z"),
    mediaAsset: { width: 1200, height: 800 },
    childTags: [{ childTag: tags.junseo }]
  },
  {
    id: "media-together",
    albumId: "album-1",
    albumDate: new Date("2026-07-02T00:00:00.000Z"),
    originalName: "together.jpg",
    uploadedById: "user-1",
    createdAt: new Date("2026-07-02T08:00:00.000Z"),
    mediaAsset: { width: 1200, height: 800 },
    childTags: [{ childTag: tags.minseo }, { childTag: tags.junseo }]
  },
  {
    id: "media-untagged",
    albumId: "album-1",
    albumDate: new Date("2026-07-02T00:00:00.000Z"),
    originalName: "family.jpg",
    uploadedById: "user-1",
    createdAt: new Date("2026-07-03T09:00:00.000Z"),
    mediaAsset: { width: 1200, height: 800 },
    childTags: []
  }
];

function filteredMedia(where: {
  albumDate?: Date | { gte: Date; lt: Date };
  childTags?: { some?: { childTagId: string | { in: string[] } }; none?: object };
  AND?: { childTags: { some: { childTagId: string } } }[];
}) {
  return mediaItems.filter((media) => {
    const dateMatches = where.albumDate instanceof Date
      ? media.albumDate.valueOf() === where.albumDate.valueOf()
      : where.albumDate
        ? media.albumDate >= where.albumDate.gte && media.albumDate < where.albumDate.lt
        : true;
    const selectedTag = where.childTags?.some?.childTagId;
    const tagMatches = selectedTag
      ? media.childTags.some((item) =>
          typeof selectedTag === "string"
            ? item.childTag.id === selectedTag
            : (selectedTag as { in: string[] }).in.includes(item.childTag.id)
        )
      : where.childTags?.none
        ? media.childTags.length === 0
        : true;
    const allTagsMatch = where.AND?.every((condition) =>
      media.childTags.some((item) => item.childTag.id === condition.childTags.some.childTagId)
    ) ?? true;
    return dateMatches && tagMatches && allTagsMatch;
  });
}

async function createTestApp() {
  const prisma = {
    familyMember: {
      findUnique: async () => ({
        familyId: "family-1",
        userId: "user-1",
        role: "OWNER"
      })
    },
    album: {
      findUnique: async () => ({
        id: "album-1",
        familyId: "family-1",
        name: "우리의 여름"
      })
    },
    media: {
      findMany: async ({ where, select, orderBy, take, cursor, skip }: {
        where: Parameters<typeof filteredMedia>[0];
        select?: { childTags?: unknown };
        orderBy?: { albumDate?: "asc" | "desc"; createdAt?: "asc" | "desc" }[];
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let rows = filteredMedia(where);
        if (orderBy?.some((item) => item.albumDate || item.createdAt)) {
          rows = [...rows].sort((left, right) =>
            right.albumDate.valueOf() - left.albumDate.valueOf()
            || right.createdAt.valueOf() - left.createdAt.valueOf()
          );
        }
        if (cursor) {
          rows = rows.slice(Math.max(0, rows.findIndex((media) => media.id === cursor.id)) + (skip ?? 0));
        }
        if (take) rows = rows.slice(0, take);
        return rows.map((media) => ({
          ...media,
          childTags: select?.childTags ? media.childTags : undefined
        }));
      },
      groupBy: async ({ where }: {
        where: Parameters<typeof filteredMedia>[0];
      }) => {
        const counts = new Map<number, number>();
        for (const media of filteredMedia(where)) {
          counts.set(media.albumDate.valueOf(), (counts.get(media.albumDate.valueOf()) ?? 0) + 1);
        }
        return [...counts].map(([timestamp, count]) => ({
          albumDate: new Date(timestamp),
          _count: { _all: count }
        }));
      }
    },
    dailyRepresentative: {
      findMany: async () => [{
        albumDate: new Date("2026-07-02T00:00:00.000Z"),
        mediaId: "media-junseo"
      }]
    }
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AlbumsController, MediaController],
    providers: [
      AlbumsService,
      MediaService,
      FamiliesService,
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: {} }
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

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe("media child tag filters", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("lists only mediaItems tagged with the selected child", async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get("/albums/album-1/media?date=2026-07-02&childTagId=tag-1")
      .expect(200);

    expect(response.body.map((media: { id: string }) => media.id)).toEqual([
      "media-minseo",
      "media-together"
    ]);
    expect(response.body[0]).toMatchObject({
      childTags: [{ id: "tag-1", name: "민서" }]
    });
  });

  it("lists only mediaItems without child tags", async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get("/albums/album-1/media?date=2026-07-02&childTagId=untagged")
      .expect(200);

    expect(response.body.map((media: { id: string }) => media.id)).toEqual(["media-untagged"]);
  });

  it("uses matching counts and representatives in a filtered calendar", async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get("/albums/album-1/calendar?month=2026-07&childTagId=tag-1")
      .expect(200);

    expect(response.body).toEqual([{
      date: "2026-07-02",
      count: 2,
      representativeMediaId: "media-minseo"
    }]);
  });

  it("matches any selected child by default", async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get("/albums/album-1/media?date=2026-07-02&childTagIds=tag-1,tag-2")
      .expect(200);

    expect(response.body.map((media: { id: string }) => media.id)).toEqual([
      "media-junseo",
      "media-minseo",
      "media-together"
    ]);
  });

  it("can require every selected child to appear together", async () => {
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get("/albums/album-1/media?date=2026-07-02&childTagIds=tag-1,tag-2&match=all")
      .expect(200);

    expect(response.body.map((media: { id: string }) => media.id)).toEqual(["media-together"]);
  });

  it("paginates a filtered album-wide media feed", async () => {
    app = await createTestApp();

    const first = await request(app.getHttpServer())
      .get("/albums/album-1/media-feed?childTagIds=tag-1&take=1")
      .expect(200);

    expect(first.body.items.map((media: { id: string }) => media.id)).toEqual(["media-minseo"]);
    expect(first.body.nextCursor).toBe("media-minseo");

    const second = await request(app.getHttpServer())
      .get(`/albums/album-1/media-feed?childTagIds=tag-1&take=1&cursor=${first.body.nextCursor}`)
      .expect(200);

    expect(second.body.items.map((media: { id: string }) => media.id)).toEqual(["media-together"]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("rejects a calendar month that does not exist", async () => {
    app = await createTestApp();

    await request(app.getHttpServer())
      .get("/albums/album-1/calendar?month=2026-13")
      .expect(400);
  });
});
