import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { HealthController } from "../src/common/health.controller.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { StorageService } from "../src/media/storage.service.js";

describe("readiness", () => {
  it("checks the required database schema as well as storage", async () => {
    const assertSchemaReady = vi.fn(async () => undefined);
    const check = vi.fn(async () => undefined);
    const controller = new HealthController(
      { assertSchemaReady } as unknown as PrismaService,
      { check } as unknown as StorageService
    );

    await expect(controller.ready()).resolves.toEqual({ status: "ready" });
    expect(assertSchemaReady).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledOnce();
  });

  it("is not ready when the database schema is outdated", async () => {
    const controller = new HealthController(
      { assertSchemaReady: async () => { throw new Error("missing column"); } } as unknown as PrismaService,
      { check: async () => undefined } as unknown as StorageService
    );

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
