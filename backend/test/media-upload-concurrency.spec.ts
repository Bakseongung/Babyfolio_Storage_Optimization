import { ConflictException, HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlbumsService } from "../src/albums/albums.service.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { MediaService } from "../src/media/media.service.js";
import { StorageService } from "../src/media/storage.service.js";

type TestStatus = "PENDING_UPLOAD" | "PROCESSING" | "READY" | "FAILED" | "DELETED";
type TestMedia = {
  id: string;
  albumId: string;
  albumDate: Date;
  uploadedById: string;
  originalName: string;
  uploadContentType: string;
  uploadSize: number;
  clientUploadId: string;
  status: TestStatus;
  tempObjectKey: string | null;
  mediaAssetId: string | null;
  failureReason: string | null;
  capturedAt: Date | null;
  dateSource: "USER";
  updatedAt: Date;
  childTags: Array<{ childTag: { id: string; name: string } }>;
};

const uploadRequest = {
  date: "2026-08-03",
  originalName: "baby.jpg",
  contentType: "image/jpeg",
  fileSize: 1_024,
  clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
};

function mediaRecord(id: string, uploadedById: string, status: TestStatus, overrides: Partial<TestMedia> = {}): TestMedia {
  return {
    id,
    albumId: "album-1",
    albumDate: new Date("2026-08-03T00:00:00.000Z"),
    uploadedById,
    originalName: "baby.jpg",
    uploadContentType: "image/jpeg",
    uploadSize: 1_024,
    clientUploadId: `00000000-0000-4000-8000-${id.padStart(12, "0").slice(-12)}`,
    status,
    tempObjectKey: `temp/family-1/${id}`,
    mediaAssetId: null,
    failureReason: null,
    capturedAt: null,
    dateSource: "USER",
    updatedAt: new Date(),
    childTags: [],
    ...overrides
  };
}

function createHarness(initialMedia: TestMedia[]) {
  const media = initialMedia;
  const lockTails = new Map<string, Promise<void>>();
  const lockKeys: string[] = [];
  let nextId = 1;

  const mediaApi = {
    findUnique: async ({ where }: {
      where: { albumId_clientUploadId?: { albumId: string; clientUploadId: string }; id?: string };
    }) => {
      const compound = where.albumId_clientUploadId;
      return media.find((item) => compound
        ? item.albumId === compound.albumId && item.clientUploadId === compound.clientUploadId
        : item.id === where.id) ?? null;
    },
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
    count: async ({ where }: {
      where: {
        uploadedById?: string;
        albumId?: string;
        albumDate?: Date;
        status?: { in: TestStatus[] };
      };
    }) => media.filter((item) =>
      (!where.uploadedById || item.uploadedById === where.uploadedById)
      && (!where.albumId || item.albumId === where.albumId)
      && (!where.albumDate || item.albumDate.getTime() === where.albumDate.getTime())
      && (!where.status || where.status.in.includes(item.status))
    ).length,
    update: async ({ where, data }: { where: { id: string }; data: Partial<TestMedia> }) => {
      const item = media.find((candidate) => candidate.id === where.id);
      if (!item) throw new Error("MEDIA_NOT_FOUND");
      Object.assign(item, data);
      return item;
    },
    create: vi.fn(async ({ data }: {
      data: {
        albumId: string;
        uploadedById: string;
        albumDate: Date;
        capturedAt: Date | null;
        dateSource: "USER";
        clientUploadId: string;
        originalName: string;
        uploadContentType: string;
        uploadSize: number;
        tempObjectKey: string;
        status: "PENDING_UPLOAD";
      };
    }) => {
      const created = mediaRecord(`new-${nextId++}`, data.uploadedById, data.status, {
        ...data,
        mediaAssetId: null,
        failureReason: null,
        updatedAt: new Date(),
        childTags: []
      });
      media.push(created);
      return created;
    })
  };

  const prisma = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const tx = {
        $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
          lockKeys.push(key);
          const previous = lockTails.get(key) ?? Promise.resolve();
          let release!: () => void;
          const current = new Promise<void>((resolve) => { release = resolve; });
          lockTails.set(key, previous.then(() => current));
          await previous;
          releases.push(release);
        },
        childTag: { count: async () => 0 },
        media: mediaApi
      };
      try {
        return await work(tx);
      } finally {
        for (const release of releases.reverse()) release();
      }
    }
  } as unknown as PrismaService;
  const albums = {
    requireAlbum: async (_userId: string, albumId: string) => ({
      album: { id: albumId, familyId: albumId === "album-2" ? "family-2" : "family-1" }
    })
  } as unknown as AlbumsService;
  const storage = {
    presignUpload: vi.fn(async () => "https://storage.example/upload")
  } as unknown as StorageService;
  return {
    media,
    lockKeys,
    create: mediaApi.create,
    service: new MediaService(prisma, albums, storage)
  };
}

describe("per-user active upload limit", () => {
  afterEach(() => {
    delete process.env.MAX_ACTIVE_UPLOADS_PER_USER;
  });

  it("allows a fifth active upload when the user currently has four", async () => {
    const harness = createHarness(Array.from({ length: 4 }, (_, index) =>
      mediaRecord(String(index + 1), "user-1", "PENDING_UPLOAD")));

    await expect(harness.service.startUpload("user-1", "album-1", uploadRequest))
      .resolves.toMatchObject({ status: "PENDING_UPLOAD" });
    expect(harness.media.filter((item) =>
      item.uploadedById === "user-1" && ["PENDING_UPLOAD", "PROCESSING"].includes(item.status)
    )).toHaveLength(5);
  });

  it("rejects a new upload with HTTP 429 when the user already has five active uploads", async () => {
    const harness = createHarness(Array.from({ length: 5 }, (_, index) =>
      mediaRecord(String(index + 1), "user-1", "PENDING_UPLOAD")));

    const failure = await harness.service.startUpload("user-1", "album-1", uploadRequest)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect((failure as HttpException).getResponse()).toMatchObject({ code: "UPLOAD_CONCURRENCY_LIMIT" });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("counts pending and processing uploads together", async () => {
    const harness = createHarness([
      ...Array.from({ length: 3 }, (_, index) => mediaRecord(`pending-${index}`, "user-1", "PENDING_UPLOAD")),
      ...Array.from({ length: 2 }, (_, index) => mediaRecord(`processing-${index}`, "user-1", "PROCESSING"))
    ]);

    await expect(harness.service.startUpload("user-1", "album-1", uploadRequest))
      .rejects.toMatchObject({ status: 429 });
  });

  it("does not count ready, failed, or deleted media as active uploads", async () => {
    const harness = createHarness([
      mediaRecord("ready", "user-1", "READY"),
      mediaRecord("failed", "user-1", "FAILED"),
      mediaRecord("deleted", "user-1", "DELETED")
    ]);

    await expect(harness.service.startUpload("user-1", "album-1", uploadRequest))
      .resolves.toMatchObject({ status: "PENDING_UPLOAD" });
  });

  it("does not let one user's active uploads block another user", async () => {
    const harness = createHarness(Array.from({ length: 5 }, (_, index) =>
      mediaRecord(String(index + 1), "user-1", "PENDING_UPLOAD")));

    await expect(harness.service.startUpload("user-2", "album-2", uploadRequest))
      .resolves.toMatchObject({ status: "PENDING_UPLOAD" });
  });

  it("serializes two starts for the same user so only one can fill the fifth slot", async () => {
    const harness = createHarness(Array.from({ length: 4 }, (_, index) =>
      mediaRecord(String(index + 1), "user-1", "PENDING_UPLOAD")));
    const requests = [
      { ...uploadRequest, clientUploadId: "10000000-0000-4000-8000-000000000001" },
      { ...uploadRequest, clientUploadId: "10000000-0000-4000-8000-000000000002" }
    ];

    const results = await Promise.allSettled(requests.map((request) =>
      harness.service.startUpload("user-1", "album-1", request)));

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(harness.media.filter((item) =>
      item.uploadedById === "user-1" && ["PENDING_UPLOAD", "PROCESSING"].includes(item.status)
    )).toHaveLength(5);
  });

  it("returns an existing idempotent upload even when all five slots are occupied", async () => {
    const existing = mediaRecord("existing", "user-1", "PENDING_UPLOAD", {
      clientUploadId: uploadRequest.clientUploadId
    });
    const harness = createHarness([
      existing,
      ...Array.from({ length: 4 }, (_, index) => mediaRecord(String(index + 1), "user-1", "PROCESSING"))
    ]);

    await expect(harness.service.startUpload("user-1", "album-1", uploadRequest))
      .resolves.toMatchObject({ mediaId: existing.id, status: "PENDING_UPLOAD" });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("creates one Media for simultaneous requests with the same clientUploadId", async () => {
    const harness = createHarness(Array.from({ length: 4 }, (_, index) =>
      mediaRecord(String(index + 1), "user-1", "PENDING_UPLOAD")));

    const results = await Promise.all([
      harness.service.startUpload("user-1", "album-1", uploadRequest),
      harness.service.startUpload("user-1", "album-1", uploadRequest)
    ]);

    expect(results[0].mediaId).toBe(results[1].mediaId);
    expect(harness.create).toHaveBeenCalledOnce();
  });

  it("keeps the date limit after the user limit check", async () => {
    const harness = createHarness(Array.from({ length: 10 }, (_, index) =>
      mediaRecord(String(index + 1), `other-user-${index}`, "READY")));

    const failure = await harness.service.startUpload("user-1", "album-1", uploadRequest)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({ code: "DAILY_MEDIA_LIMIT" });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("acquires the user lock before the album-date lock", async () => {
    const harness = createHarness([]);

    await harness.service.startUpload("user-1", "album-1", uploadRequest);

    expect(harness.lockKeys.slice(0, 2)).toEqual([
      "upload-user:user-1",
      "album-1:2026-08-03"
    ]);
  });
});
