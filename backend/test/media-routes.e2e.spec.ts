import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionGuard } from "../src/auth/session.guard.js";
import { MediaController } from "../src/media/media.controller.js";
import { MediaService } from "../src/media/media.service.js";

describe("media HTTP routes", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("completes an upload through POST /media/:mediaId/complete", async () => {
    const queueCompletion = vi.fn(async () => ({ mediaId: "media-1", status: "PROCESSING" }));
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { queueCompletion } }]
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
    await app.init();

    await request(app.getHttpServer())
      .post("/media/media-1/complete")
      .expect(201)
      .expect({ mediaId: "media-1", status: "PROCESSING" });
    expect(queueCompletion).toHaveBeenCalledWith("user-1", "media-1");
  });

  it("returns processing state through GET /media/:mediaId/status", async () => {
    const status = vi.fn(async () => ({ mediaId: "media-1", status: "PROCESSING", failureReason: null }));
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { status } }]
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
    await app.init();

    await request(app.getHttpServer())
      .get("/media/media-1/status")
      .expect(200)
      .expect({ mediaId: "media-1", status: "PROCESSING", failureReason: null });
    expect(status).toHaveBeenCalledWith("user-1", "media-1");
  });

  it("returns a signed URL through GET /media/:mediaId/url", async () => {
    const url = vi.fn(async () => ({ url: "https://storage.example/media-1" }));
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { url } }]
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
    await app.init();

    await request(app.getHttpServer())
      .get("/media/media-1/url?variant=display")
      .expect(200)
      .expect({ url: "https://storage.example/media-1" });
    expect(url).toHaveBeenCalledWith("user-1", "media-1", "display");
  });

  it("deletes an item through DELETE /media/:mediaId", async () => {
    const remove = vi.fn(async () => ({ ok: true }));
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: { remove } }]
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
    await app.init();

    await request(app.getHttpServer())
      .delete("/media/media-1")
      .expect(200)
      .expect({ ok: true });
    expect(remove).toHaveBeenCalledWith("user-1", "media-1");
  });
});
