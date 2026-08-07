import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlbumsService } from "../src/albums/albums.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { FamiliesService } from "../src/families/families.service.js";
import { MediaController } from "../src/media/media.controller.js";
import { MediaService } from "../src/media/media.service.js";
import { StorageService } from "../src/media/storage.service.js";

const tags = [
  { id: "tag-1", name: "민서" },
  { id: "tag-2", name: "준서" }
];

async function createTestApp(
  validTagCount: number,
  staleMedia: { id: string; tempObjectKey: string | null }[] = [],
  userActiveCount = 0
) {
  let activeCount = staleMedia.length ? 10 : 0;
  const deleteObject = vi.fn(async () => undefined);
  const prisma = {
    familyMember: {
      findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
    },
    album: {
      findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      $executeRaw: async () => undefined,
      childTag: {
        count: async () => validTagCount
      },
      media: {
        findUnique: async () => null,
        findMany: async () => staleMedia,
        updateMany: async () => {
          activeCount -= staleMedia.length;
          return { count: staleMedia.length };
        },
        count: async ({ where }: { where: { uploadedById?: string } }) =>
          where.uploadedById ? userActiveCount : activeCount,
        create: async ({ data }: {
          data: {
            capturedAt?: Date;
            dateSource?: string;
            childTags?: { createMany: { data: { childTagId: string }[] } };
          }
        }) => ({
          id: "media-1",
          status: "PENDING_UPLOAD",
          tempObjectKey: "temp/family-1/media-1",
          capturedAt: data.capturedAt ?? null,
          dateSource: data.dateSource ?? "USER",
          childTags: data.childTags?.createMany.data.map(({ childTagId }) => ({
            childTag: tags.find((tag) => tag.id === childTagId)
          })) ?? []
        })
      }
    })
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [
      MediaService,
      AlbumsService,
      FamiliesService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: StorageService,
        useValue: {
          presignUpload: async () => "https://storage.example/upload",
          delete: deleteObject
        }
      }
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

  const testApp = moduleRef.createNestApplication();
  testApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await testApp.init();
  Object.assign(testApp, { deleteObject });
  return testApp;
}

const uploadRequest = {
  date: "2026-08-03",
  originalName: "siblings.jpg",
  contentType: "image/jpeg",
  fileSize: 1024,
  clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
};

describe("media child tag API", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("starts an upload with manually selected child tags", async () => {
    app = await createTestApp(tags.length);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send({
        ...uploadRequest,
        childTagIds: ["tag-1", "tag-2"]
      })
      .expect(201);

    expect(response.body).toMatchObject({
      mediaId: "media-1",
      childTags: [{ id: "tag-1", name: "민서" }, { id: "tag-2", name: "준서" }]
    });
  });

  it("starts an upload when no child tag is selected", async () => {
    app = await createTestApp(0);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send(uploadRequest)
      .expect(201);

    expect(response.body).toMatchObject({ mediaId: "media-1", childTags: [] });
  });

  it("rejects a child tag from another album", async () => {
    app = await createTestApp(1);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send({
        ...uploadRequest,
        childTagIds: ["tag-1", "tag-from-another-album"]
      })
      .expect(400);

    expect(response.body).toMatchObject({
      code: "INVALID_CHILD_TAG"
    });
  });

  it("stores the confirmed metadata date and its source", async () => {
    app = await createTestApp(0);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send({
        ...uploadRequest,
        capturedAt: "2026-07-28T06:30:00.000Z",
        dateSource: "EXIF_ORIGINAL"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      mediaId: "media-1",
      capturedAt: "2026-07-28T06:30:00.000Z",
      dateSource: "EXIF_ORIGINAL"
    });
  });

  it("rejects a calendar date that does not exist", async () => {
    app = await createTestApp(0);

    await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send({ ...uploadRequest, date: "2026-02-31" })
      .expect(400);
  });

  it("rejects a declared upload larger than 20 MiB", async () => {
    app = await createTestApp(0);

    await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send({ ...uploadRequest, fileSize: 20 * 1024 * 1024 + 1 })
      .expect(400);
  });

  it("expires abandoned uploads before enforcing the daily limit", async () => {
    app = await createTestApp(0, [{ id: "stale-media", tempObjectKey: "temp/family-1/stale-media" }]);

    await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send(uploadRequest)
      .expect(201);

    expect((app as INestApplication & { deleteObject: ReturnType<typeof vi.fn> }).deleteObject)
      .toHaveBeenCalledWith("temp/family-1/stale-media");
  });

  it("returns HTTP 429 when the user already has five active uploads", async () => {
    app = await createTestApp(0, [], 5);

    const response = await request(app.getHttpServer())
      .post("/albums/album-1/uploads")
      .send(uploadRequest)
      .expect(429);

    expect(response.body).toMatchObject({
      code: "UPLOAD_CONCURRENCY_LIMIT",
      message: "동시에 최대 5개의 파일만 업로드할 수 있습니다."
    });
  });
});
