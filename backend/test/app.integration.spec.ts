import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { StorageService } from "../src/media/storage.service.js";

const integration = process.env.RUN_INTEGRATION === "1";
const originalMaxActiveUploads = process.env.MAX_ACTIVE_UPLOADS_PER_USER;
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNQ6n4GAAJmAZTWXMniAAAAAElFTkSuQmCC",
  "base64"
);

describe.runIf(integration)("real PostgreSQL and S3 application boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let familyId: string | undefined;
  let userId: string | undefined;

  beforeAll(async () => {
    process.env.MAX_ACTIVE_UPLOADS_PER_USER = "5";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    );
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    if (familyId && prisma && storage) {
      const assets = await prisma.mediaAsset.findMany({
        where: { familyId },
        select: { originalKey: true, displayKey: true, thumbnailKey: true }
      });
      await Promise.allSettled(
        assets.flatMap((asset) => [
          storage.delete(asset.originalKey),
          storage.delete(asset.displayKey),
          storage.delete(asset.thumbnailKey)
        ])
      );
      await prisma.family.deleteMany({ where: { id: familyId } });
    }
    if (userId && prisma) await prisma.user.deleteMany({ where: { id: userId } });
    if (app) await app.close();
    if (originalMaxActiveUploads === undefined) delete process.env.MAX_ACTIVE_UPLOADS_PER_USER;
    else process.env.MAX_ACTIVE_UPLOADS_PER_USER = originalMaxActiveUploads;
  });

  it("migrates, authenticates, uploads, transforms, lists, and downloads a private media", async () => {
    await request(app.getHttpServer()).get("/api/health/ready").expect(200);

    const signup = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        email: `integration+${randomUUID()}@example.com`,
        password: "integration-password",
        displayName: "통합 테스트"
      })
      .expect(201);
    userId = signup.body.user.id as string;
    const sessionCookie = signup.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(sessionCookie).toBeTruthy();
    if (!sessionCookie) throw new Error("signup did not set a session cookie");

    const family = await request(app.getHttpServer())
      .post("/api/families")
      .set("Cookie", sessionCookie)
      .send({ name: "통합 테스트 가족" })
      .expect(201);
    familyId = family.body.id as string;

    const album = await request(app.getHttpServer())
      .post(`/api/families/${familyId}/albums`)
      .set("Cookie", sessionCookie)
      .send({ name: "통합 테스트 앨범", childNames: ["아이"] })
      .expect(201);
    const albumId = album.body.id as string;
    const childTagId = album.body.childTags[0].id as string;

    const start = await request(app.getHttpServer())
      .post(`/api/albums/${albumId}/uploads`)
      .set("Cookie", sessionCookie)
      .send({
        date: "2026-08-02",
        originalName: "pixel.png",
        contentType: "image/png",
        fileSize: onePixelPng.length,
        clientUploadId: randomUUID(),
        childTagIds: [childTagId]
      })
      .expect(201);

    const upload = await fetch(start.body.uploadUrl as string, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: onePixelPng
    });
    expect(upload.ok).toBe(true);

    const completed = await request(app.getHttpServer())
      .post(`/api/media/${start.body.mediaId}/complete`)
      .set("Cookie", sessionCookie);
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect(completed.body.status).toBe("PROCESSING");

    let processingStatus = "PROCESSING";
    for (let attempt = 0; attempt < 50 && !["READY", "FAILED"].includes(processingStatus); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const status = await request(app.getHttpServer())
        .get(`/api/media/${start.body.mediaId}/status`)
        .set("Cookie", sessionCookie)
        .expect(200);
      processingStatus = status.body.status as string;
    }
    expect(processingStatus).toBe("READY");

    const items = await request(app.getHttpServer())
      .get(`/api/albums/${albumId}/media?date=2026-08-02`)
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(items.body).toHaveLength(1);
    expect(items.body[0].id).toBe(start.body.mediaId);

    const signed = await request(app.getHttpServer())
      .get(`/api/media/${start.body.mediaId}/url?variant=thumbnail`)
      .set("Cookie", sessionCookie)
      .expect(200);
    const thumbnail = await fetch(signed.body.url as string);
    expect(thumbnail.ok).toBe(true);
    expect(thumbnail.headers.get("content-type")).toContain("image/webp");
    expect((await thumbnail.arrayBuffer()).byteLength).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .delete(`/api/albums/${albumId}/child-tags/${childTagId}`)
      .set("Cookie", sessionCookie)
      .expect(204);

    const mediaItemsAfterTagDelete = await request(app.getHttpServer())
      .get(`/api/albums/${albumId}/media?date=2026-08-02`)
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(mediaItemsAfterTagDelete.body).toHaveLength(1);
    expect(mediaItemsAfterTagDelete.body[0]).toMatchObject({
      id: start.body.mediaId,
      childTags: []
    });

    const signedAfterTagDelete = await request(app.getHttpServer())
      .get(`/api/media/${start.body.mediaId}/url?variant=thumbnail`)
      .set("Cookie", sessionCookie)
      .expect(200);
    expect((await fetch(signedAfterTagDelete.body.url as string)).ok).toBe(true);

    const pendingPayload = (clientUploadId: string) => ({
      date: "2026-08-03",
      originalName: "pending.png",
      contentType: "image/png",
      fileSize: onePixelPng.length,
      clientUploadId
    });
    await Promise.all(Array.from({ length: 4 }, async () =>
      request(app.getHttpServer())
        .post(`/api/albums/${albumId}/uploads`)
        .set("Cookie", sessionCookie)
        .send(pendingPayload(randomUUID()))
        .expect(201)));

    const competing = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/albums/${albumId}/uploads`)
        .set("Cookie", sessionCookie)
        .send(pendingPayload(randomUUID())),
      request(app.getHttpServer())
        .post(`/api/albums/${albumId}/uploads`)
        .set("Cookie", sessionCookie)
        .send(pendingPayload(randomUUID()))
    ]);
    expect(competing.map(({ status }) => status).sort()).toEqual([201, 429]);
    expect(competing.find(({ status }) => status === 429)?.body).toMatchObject({
      code: "UPLOAD_CONCURRENCY_LIMIT"
    });

    const accepted = competing.find(({ status }) => status === 201);
    expect(accepted?.body.mediaId).toBeTruthy();
    await request(app.getHttpServer())
      .delete(`/api/media/${accepted?.body.mediaId}`)
      .set("Cookie", sessionCookie)
      .expect(200);

    const idempotentUploadId = randomUUID();
    const repeated = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/albums/${albumId}/uploads`)
        .set("Cookie", sessionCookie)
        .send(pendingPayload(idempotentUploadId))
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/albums/${albumId}/uploads`)
        .set("Cookie", sessionCookie)
        .send(pendingPayload(idempotentUploadId))
        .expect(201)
    ]);
    expect(repeated[0].body.mediaId).toBe(repeated[1].body.mediaId);
  }, 30_000);
});
