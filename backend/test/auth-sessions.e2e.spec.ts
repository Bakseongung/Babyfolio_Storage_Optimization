import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { createHash } from "node:crypto";
import { hash } from "argon2";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AuthController } from "../src/auth/auth.controller.js";
import { AuthService } from "../src/auth/auth.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { env } from "../src/common/env.js";

type TestSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
};

const user = {
  id: "user-1",
  email: "parent@example.com",
  displayName: "부모"
};

async function createAuthApp(initialSessions: TestSession[], uniqueCreateFailure = false) {
  const sessions = [...initialSessions];
  const passwordHash = await hash("correct-password");

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        where.email === user.email ? { ...user, passwordHash } : null,
      create: async () => {
        if (uniqueCreateFailure) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        return { ...user, passwordHash };
      }
    },
    session: {
      create: async ({ data }: { data: TestSession }) => {
        const session = { ...data, createdAt: data.createdAt ?? new Date() };
        sessions.push(session);
        return session;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = sessions.length;
        const shouldDelete = (session: TestSession) => {
          if (typeof where.id === "string") return session.id === where.id;
          if (typeof where.userId === "string") return session.userId === where.userId;
          if (Array.isArray(where.OR)) {
            return where.OR.some((condition) => {
              if (condition.id) return session.id === condition.id;
              const expiresAt = condition.expiresAt as { lte?: Date } | undefined;
              return expiresAt?.lte ? session.expiresAt <= expiresAt.lte : false;
            });
          }
          return false;
        };
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (shouldDelete(sessions[index])) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      },
      findFirst: async ({ where }: { where: { id: string; expiresAt: { gt: Date } } }) => {
        const session = sessions.find((item) =>
          item.id === where.id && item.expiresAt > where.expiresAt.gt
        );
        return session ? { ...session, user } : null;
      }
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma)
  };

  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
    controllers: [AuthController],
    providers: [
      AuthService,
      SessionGuard,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: PrismaService, useValue: prisma }
    ]
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 86_400_000);
const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
const session = (id: string, expiresAt = future()): TestSession => ({
  id: sessionHash(id),
  userId: user.id,
  expiresAt,
  createdAt: new Date()
});
const cookie = (id: string) => `${env.sessionCookieName}=${id}`;

describe("auth session lifecycle", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("rotates the current browser session and preserves another device", async () => {
    app = await createAuthApp([
      session("current-browser"),
      session("other-device"),
      session("expired-session", past())
    ]);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Cookie", cookie("current-browser"))
      .send({ email: user.email, password: "correct-password" })
      .expect(201);

    const newCookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(newCookie).toBeTruthy();

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("current-browser"))
      .expect(401);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("other-device"))
      .expect(200);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", newCookie)
      .expect(200);
  });

  it("logs out only the current browser", async () => {
    app = await createAuthApp([
      session("current-browser"),
      session("other-device")
    ]);

    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie("current-browser"))
      .expect(201);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("current-browser"))
      .expect(401);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("other-device"))
      .expect(200);
  });

  it("logs out every session owned by the current user", async () => {
    app = await createAuthApp([
      session("current-browser"),
      session("other-device")
    ]);

    await request(app.getHttpServer())
      .post("/auth/logout-all")
      .set("Cookie", cookie("current-browser"))
      .expect(201);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("current-browser"))
      .expect(401);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie("other-device"))
      .expect(401);
  });

  it("rate limits repeated login attempts", async () => {
    app = await createAuthApp([]);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: user.email, password: "correct-password" })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "correct-password" })
      .expect(429);
  });

  it("returns a conflict when another signup wins the email race", async () => {
    app = await createAuthApp([], true);

    const response = await request(app.getHttpServer())
      .post("/auth/signup")
      .send({ email: "new@example.com", password: "correct-password", displayName: "새 가족" })
      .expect(409);

    expect(response.body).toMatchObject({ code: "EMAIL_EXISTS" });
  });

  it("rejects a whitespace-only display name", async () => {
    app = await createAuthApp([]);

    await request(app.getHttpServer())
      .post("/auth/signup")
      .send({ email: "new@example.com", password: "correct-password", displayName: "   " })
      .expect(400);
  });

  it("rejects an excessively long password before hashing it", async () => {
    app = await createAuthApp([]);

    await request(app.getHttpServer())
      .post("/auth/signup")
      .send({ email: "new@example.com", password: "a".repeat(129), displayName: "새 가족" })
      .expect(400);
  });

  it("rejects an excessively long login password before verifying it", async () => {
    app = await createAuthApp([]);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "a".repeat(129) })
      .expect(400);
  });
});
