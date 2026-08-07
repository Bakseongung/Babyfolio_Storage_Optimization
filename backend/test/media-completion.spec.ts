import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumsService } from "../src/albums/albums.service.js";
import { PrismaService } from "../src/common/prisma.service.js";
import { FamiliesService } from "../src/families/families.service.js";
import { MediaService } from "../src/media/media.service.js";
import { StorageService } from "../src/media/storage.service.js";

const { processMp4Mock } = vi.hoisted(() => ({ processMp4Mock: vi.fn() }));
vi.mock("../src/media/video-processor.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/media/video-processor.js")>(),
  processMp4: processMp4Mock
}));

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("media completion recovery", () => {
  beforeEach(() => {
    processMp4Mock.mockReset();
  });

  it("creates an independent asset for each duplicate image", async () => {

    const mediaStates = [
      {
        id: "media-1",
        albumId: "album-1",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-1/media-1",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        failureReason: null as string | null,
        album: { id: "album-1", familyId: "family-1" },
        mediaAsset: null as Record<string, unknown> | null
      },
      {
        id: "media-2",
        albumId: "album-1",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-1/media-2",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        failureReason: null as string | null,
        album: { id: "album-1", familyId: "family-1" },
        mediaAsset: null as Record<string, unknown> | null
      }
    ];

    const assets: Array<Record<string, unknown>> = [];
    const tx = {
      $executeRaw: async () => undefined,
      mediaAsset: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const asset = { id: `asset-${assets.length + 1}`, ...data };
          assets.push(asset);
          return asset;
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          assets.find((item) => item.id === where.id) ?? null,
        updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
          const asset = assets.find((item) => item.id === where.id);
          if (!asset || (where.status && asset.status !== where.status)) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const asset = assets.find((item) => item.id === where.id);
          if (!asset) throw new Error("ASSET_NOT_FOUND");
          Object.assign(asset, data);
          return asset;
        }
      },
      media: {
        updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaStates.find((item) => item.id === where.id);
          if (!current) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const current = mediaStates.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          const asset = assets.find((item) => item.id === current.mediaAssetId);
          return { ...current, mediaAsset: asset ?? null };
        }
      },
      dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
    };
    const prisma = {
      media: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const current = mediaStates.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          return { ...current, mediaAsset: current.mediaAssetId ? assets[0] : null };
        },
        updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaStates.find((item) => item.id === where.id);
          if (!current) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaStates.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          Object.assign(current, data);
          return { ...current, mediaAsset: current.mediaAssetId ? assets[0] : null };
        }
      },
      $transaction: async (work: (tx: Record<string, unknown>) => Promise<unknown>) => work(tx as unknown as Record<string, unknown>)
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: { familyId: "family-1" } }) } as unknown as AlbumsService;
    const put = vi.fn(async () => undefined);
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put,
      delete: async () => undefined
    } as unknown as StorageService;
    const service = new MediaService(prisma, albums, storage);

    await expect(service.complete("user-1", "media-1")).resolves.toEqual({ mediaId: "media-1", status: "READY" });
    await expect(service.complete("user-1", "media-2")).resolves.toEqual({ mediaId: "media-2", status: "READY" });

    expect(assets).toHaveLength(2);
    expect(assets[0].originalKey).not.toBe(assets[1].originalKey);
    expect(assets[0].displayKey).not.toBe(assets[1].displayKey);
    expect(assets[0].thumbnailKey).not.toBe(assets[1].thumbnailKey);
    expect(put).toHaveBeenCalledTimes(6);
  });

  it("does not share repeated files across families", async () => {

    const mediaRecords = [
      {
        id: "media-1",
        albumId: "album-1",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-1/media-1",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        album: { id: "album-1", familyId: "family-1" },
        mediaAsset: null as Record<string, unknown> | null
      },
      {
        id: "media-2",
        albumId: "album-2",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-2/media-2",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        album: { id: "album-2", familyId: "family-2" },
        mediaAsset: null as Record<string, unknown> | null
      }
    ];
    const assets: Array<Record<string, unknown>> = [];
    const prisma = {
      media: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          const asset = assets.find((asset) => asset.id === current.mediaAssetId);
          return { ...current, mediaAsset: asset ?? null };
        },
        updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          Object.assign(current, data);
          const asset = assets.find((asset) => asset.id === current.mediaAssetId);
          return { ...current, mediaAsset: asset ?? null };
        }
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        mediaAsset: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const asset = { id: `asset-${assets.length + 1}`, ...data };
            assets.push(asset);
            return asset;
          },
          findUnique: async ({ where }: { where: { id: string } }) =>
            assets.find((item) => item.id === where.id) ?? null,
          updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
            const asset = assets.find((item) => item.id === where.id);
            if (!asset || (where.status && asset.status !== where.status)) return { count: 0 };
            Object.assign(asset, data);
            return { count: 1 };
          },
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const asset = assets.find((item) => item.id === where.id);
            if (!asset) throw new Error("ASSET_NOT_FOUND");
            Object.assign(asset, data);
            return asset;
          }
        },
        media: {
          updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const current = mediaRecords.find((item) => item.id === where.id);
            if (!current) return { count: 0 };
            Object.assign(current, data);
            return { count: 1 };
          },
          findUnique: async ({ where }: { where: { id: string } }) => {
            const current = mediaRecords.find((item) => item.id === where.id);
            if (!current) throw new Error("MEDIA_NOT_FOUND");
            const asset = assets.find((asset) => asset.id === current.mediaAssetId);
            return { ...current, mediaAsset: asset ?? null };
          }
        },
        dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
      })
    } as unknown as PrismaService;
    const albums = {
      requireAlbum: async (_userId: string, albumId: string) => ({
        album: mediaRecords.find((item) => item.albumId === albumId)!.album
      })
    } as unknown as AlbumsService;
    const put = vi.fn(async () => undefined);
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put,
      delete: async () => undefined
    } as unknown as StorageService;

    const service = new MediaService(prisma, albums, storage);
    await expect(service.complete("user-1", "media-1")).resolves.toEqual({ mediaId: "media-1", status: "READY" });
    await expect(service.complete("user-1", "media-2")).resolves.toEqual({ mediaId: "media-2", status: "READY" });

    expect(assets).toHaveLength(2);
    expect(assets[0].originalKey).not.toBe(assets[1].originalKey);
    expect(assets[0].displayKey).not.toBe(assets[1].displayKey);
    expect(assets[0].thumbnailKey).not.toBe(assets[1].thumbnailKey);
    expect(assets[0].familyId).toBe("family-1");
    expect(assets[1].familyId).toBe("family-2");
    expect(put).toHaveBeenCalledTimes(6);
  });

  it("processes identical files concurrently without sharing assets", async () => {

    const mediaRecords = [
      {
        id: "media-1",
        albumId: "album-1",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-1/media-1",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        album: { id: "album-1", familyId: "family-1" },
        mediaAsset: null as Record<string, unknown> | null
      },
      {
        id: "media-2",
        albumId: "album-1",
        albumDate: new Date("2026-08-03T00:00:00.000Z"),
        uploadedById: "user-1",
        originalName: "baby.png",
        uploadContentType: "image/png",
        uploadSize: png.length,
        tempObjectKey: "temp/family-1/media-2",
        mediaAssetId: null as string | null,
        status: "PENDING_UPLOAD",
        album: { id: "album-1", familyId: "family-1" },
        mediaAsset: null as Record<string, unknown> | null
      }
    ];
    const assets: Array<Record<string, unknown>> = [];
    const assetById = new Map<string, Record<string, unknown>>();
    let assetReadyWrites = 0;
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let uploadRelease: (() => void) | undefined;
    const uploadGate = new Promise<void>((resolve) => {
      uploadRelease = resolve;
    });
    const put = vi.fn(async () => {
      signalUploadStarted();
      await uploadGate;
    });
    const createAsset = async ({ data }: { data: Record<string, unknown> }) => {
      const asset = { id: `asset-${assets.length + 1}`, ...data, updatedAt: new Date() };
      assets.push(asset);
      assetById.set(asset.id as string, asset);
      return asset;
    };
    const findAsset = async ({ where }: { where: { id: string } }) => assetById.get(where.id) ?? null;
    const updateManyAssets = async ({ where, data }: {
      where: { id: string; status?: string; updatedAt?: Date | { lt: Date } };
      data: Record<string, unknown>;
    }) => {
      const asset = assetById.get(where.id);
      if (!asset || (where.status && asset.status !== where.status)) return { count: 0 };
      if (where.updatedAt instanceof Date && (asset.updatedAt as Date).getTime() !== where.updatedAt.getTime()) {
        return { count: 0 };
      }
      if (where.updatedAt && !(where.updatedAt instanceof Date)
        && (asset.updatedAt as Date) >= where.updatedAt.lt) return { count: 0 };
      if (data.status === "READY") assetReadyWrites += 1;
      Object.assign(asset, data);
      return { count: 1 };
    };
    const prisma = {
      media: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          const asset = assets.find((asset) => asset.id === current.mediaAssetId);
          return { ...current, mediaAsset: asset ?? null };
        },
        updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) return { count: 0 };
          Object.assign(current, data);
          return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = mediaRecords.find((item) => item.id === where.id);
          if (!current) throw new Error("MEDIA_NOT_FOUND");
          Object.assign(current, data);
          const asset = assets.find((asset) => asset.id === current.mediaAssetId);
          return { ...current, mediaAsset: asset ?? null };
        }
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        mediaAsset: {
          findUnique: findAsset,
          create: createAsset,
          updateMany: updateManyAssets
        },
        media: {
          updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const current = mediaRecords.find((item) => item.id === where.id);
            if (!current) return { count: 0 };
            Object.assign(current, data);
            return { count: 1 };
          },
          findUnique: async ({ where }: { where: { id: string } }) => {
            const current = mediaRecords.find((item) => item.id === where.id);
            if (!current) throw new Error("MEDIA_NOT_FOUND");
            const asset = assets.find((asset) => asset.id === current.mediaAssetId);
            return { ...current, mediaAsset: asset ?? null };
          }
        },
        dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
      })
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: { familyId: "family-1" } }) } as unknown as AlbumsService;
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put,
      delete: async () => undefined
    } as unknown as StorageService;

    const service = new MediaService(prisma, albums, storage);
    const first = service.complete("user-1", "media-1");
    await uploadStarted;
    const second = service.complete("user-1", "media-2");
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(6));
    expect(mediaRecords[1].mediaAssetId).toBe("asset-2");
    uploadRelease?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { mediaId: "media-1", status: "READY" },
      { mediaId: "media-2", status: "READY" }
    ]);
    expect(assets).toHaveLength(2);
    expect(put).toHaveBeenCalledTimes(6);
    expect(assetReadyWrites).toBe(2);
  });

  it("completes an MP4 upload with its generated thumbnail", async () => {
    const media = {
      id: "video-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.mp4",
      uploadContentType: "video/mp4",
      uploadSize: 3,
      tempObjectKey: "temp/family-1/video-1",
      mediaAssetId: null as string | null,
      status: "PENDING_UPLOAD",
      album: { familyId: "family-1" },
      mediaAsset: null
    };
    let asset: Record<string, unknown> | null = null;
    const updateMedia = (data: Record<string, unknown>) => {
      Object.assign(media, data);
      return { ...media, mediaAsset: asset };
    };
    const transaction = async (work: (tx: unknown) => Promise<unknown>) => work({
      $executeRaw: async () => undefined,
      mediaAsset: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          asset = { id: "asset-video", ...data, updatedAt: new Date() };
          return asset;
        },
        findUnique: async () => asset,
        updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
          if (!asset || (where.status && asset.status !== where.status)) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset!, data);
          return asset;
        }
      },
      media: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        findUnique: async () => ({ ...media, mediaAsset: asset })
      },
      dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
    });
    const prisma = {
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data)
      },
      $transaction: transaction
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: media.album }) } as unknown as AlbumsService;
    const put = vi.fn(async () => undefined);
    const copy = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);
    const storage = {
      readVideo: async () => ({
        path: "input.mp4",
        contentType: "video/mp4",
        cleanup
      }),
      copy,
      put,
      delete: async () => undefined
    } as unknown as StorageService;
    processMp4Mock.mockResolvedValue({
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      thumbnail: Buffer.from("thumbnail")
    });

    await expect(new MediaService(prisma, albums, storage).complete("user-1", media.id))
      .resolves.toEqual({ mediaId: media.id, status: "READY" });
    expect(asset).toMatchObject({ mimeType: "video/mp4", width: 1920, height: 1080 });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps a partially written media asset linked for retry or deletion", async () => {
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      mimeType: "image/png",
      width: 1,
      height: 1,
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "ORPHANED",
      updatedAt: new Date()
    };
    let storedAsset: typeof asset | null = null;
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.png",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null as string | null,
      status: "PENDING_UPLOAD",
      album: { familyId: "family-1" },
      mediaAsset: null
    };
    const updateMedia = (data: Record<string, unknown>) => {
      Object.assign(media, data);
      return { ...media, mediaAsset: storedAsset };
    };
    const transaction = async (work: (tx: unknown) => Promise<unknown>) => work({
      $executeRaw: async () => undefined,
      mediaAsset: {
        findUnique: async () => storedAsset,
        create: async () => {
          storedAsset = asset;
          return storedAsset;
        },
        updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
          if (!storedAsset || (where.status && storedAsset.status !== where.status)) return { count: 0 };
          Object.assign(storedAsset, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return asset;
        }
      },
      media: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        findUnique: async () => ({ ...media, mediaAsset: storedAsset })
      },
      dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
    });
    const prisma = {
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data)
      },
      mediaAsset: {
        findUnique: async () => storedAsset,
        upsert: async () => {
          storedAsset = asset;
          return storedAsset;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return asset;
        }
      },
      $transaction: transaction
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: media.album }) } as unknown as AlbumsService;
    let writes = 0;
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put: async () => {
        if (media.mediaAssetId !== asset.id) throw new Error("ASSET_NOT_RESERVED");
        writes += 1;
        if (writes === 2) throw new Error("DERIVATIVE_WRITE_FAILED");
      },
      delete: async () => undefined
    } as unknown as StorageService;

    await expect(new MediaService(prisma, albums, storage).complete("user-1", media.id))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(media).toMatchObject({ status: "FAILED", mediaAssetId: asset.id });
    expect(storedAsset).toMatchObject({ status: "ORPHANED" });
  });

  it("can retry when representative selection fails after processing", async () => {
    let representativeFails = true;
    let media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      originalName: "baby.png",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null as string | null,
      failureReason: null as string | null,
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null as { id: string } | null
    };
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      mimeType: "image/png",
      width: 1,
      height: 1,
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "READY",
      updatedAt: new Date()
    };
    const updateMedia = (data: Record<string, unknown>, target = media) => {
      Object.assign(target, data);
      target.mediaAsset = target.mediaAssetId ? asset : null;
      return { ...target };
    };
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data)
      },
      mediaAsset: {
        findUnique: async () => asset,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return asset;
        }
      },
      dailyRepresentative: {
        upsert: async () => {
          if (representativeFails) {
            representativeFails = false;
            throw new Error("REPRESENTATIVE_WRITE_FAILED");
          }
          return { id: "representative-1" };
        }
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        const draft = { ...media };
        const result = await work({
          $executeRaw: async () => undefined,
          mediaAsset: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(asset, data);
              return asset;
            },
            findUnique: async () => asset,
            updateMany: async ({ where, data }: {
              where: { status?: string | { in: string[] } };
              data: Record<string, unknown>;
            }) => {
              const statuses = typeof where.status === "string" ? [where.status] : where.status?.in ?? [];
              if (statuses.length > 0 && !statuses.includes(asset.status)) return { count: 0 };
              Object.assign(asset, data);
              return { count: 1 };
            },
            update: async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(asset, data);
              return asset;
            }
          },
          media: {
            count: async () => 0,
            update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data, draft),
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
              updateMedia(data, draft);
              return { count: 1 };
            },
            findUnique: async () => ({ ...draft })
          },
          dailyRepresentative: {
            upsert: async () => {
              if (representativeFails) {
                representativeFails = false;
                throw new Error("REPRESENTATIVE_WRITE_FAILED");
              }
              return { id: "representative-1" };
            }
          }
        });
        media = draft;
        return result;
      }
    } as unknown as PrismaService;
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put: async () => undefined,
      delete: async () => undefined
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "MEDIA_PROCESSING_FAILED"
    });
    expect(asset.status).toBe("READY");
    await expect(mediaItems.complete("user-1", "media-1")).resolves.toEqual({
      mediaId: "media-1",
      status: "READY"
    });
  });

  it("does not resurrect a media deleted during processing", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      originalName: "baby.png",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null as string | null,
      failureReason: null as string | null,
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null as { id: string } | null
    };
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      mimeType: "image/png",
      width: 1,
      height: 1,
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "READY",
      updatedAt: new Date()
    };
    const updateMedia = (data: Record<string, unknown>) => {
      Object.assign(media, data);
      media.mediaAsset = media.mediaAssetId ? asset : null;
      return { ...media };
    };
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data)
      },
      mediaAsset: {
        findUnique: async () => asset,
        upsert: async () => asset
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        media.status = "DELETED";
        return work({
          $executeRaw: async () => undefined,
          mediaAsset: {
            upsert: async () => asset,
            findUnique: async () => asset,
            updateMany: async () => ({ count: 0 }),
            update: async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(asset, data);
              return asset;
            }
          },
          media: {
            update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data),
            updateMany: async ({ data }: { data: Record<string, unknown> }) => {
              if (media.status !== "PROCESSING") return { count: 0 };
              updateMedia(data);
              return { count: 1 };
            },
            findUnique: async () => ({ ...media })
          },
          dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
        });
      }
    } as unknown as PrismaService;
    const deleteObject = vi.fn(async () => undefined);
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      delete: deleteObject
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "MEDIA_STATE_CHANGED"
    });
    expect(media.status).toBe("DELETED");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("leaves an upload retryable while its matching asset is being deleted", async () => {
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      status: "DELETING",
      updatedAt: new Date()
    };
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      originalName: "baby.png",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: asset.id as string | null,
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: asset
    };
    const updateMedia = (data: Record<string, unknown>) => {
      Object.assign(media, data);
      return { ...media };
    };
    const tx = {
      $executeRaw: async () => undefined,
      media: {
        count: async () => 0,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        findUnique: async () => ({ ...media })
      },
      mediaAsset: {
        findUnique: async () => asset,
        updateMany: async () => ({ count: 0 })
      }
    };
    const prisma = {
      media: {
        findUnique: async () => ({ ...media }),
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        }
      },
      $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;
    const albums = {
      requireAlbum: async () => ({ album: media.album })
    } as unknown as AlbumsService;
    const put = vi.fn(async () => undefined);
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put
    } as unknown as StorageService;

    await expect(new MediaService(prisma, albums, storage).complete("user-1", media.id))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(media.status).toBe("FAILED");
    expect(put).not.toHaveBeenCalled();
  });

  it("reclaims an abandoned media-asset deletion when the same media is uploaded again", async () => {
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "DELETING",
      updatedAt: new Date(0)
    };
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      originalName: "baby.png",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1" as string | null,
      mediaAssetId: asset.id as string | null,
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: asset
    };
    const updateMedia = (data: Record<string, unknown>) => {
      Object.assign(media, data);
      return { ...media, mediaAsset: asset };
    };
    const tx = {
      $executeRaw: async () => undefined,
      mediaAsset: {
        findUnique: async () => asset,
        updateMany: async ({ where, data }: {
          where: { status?: string | { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          const statuses = typeof where.status === "string" ? [where.status] : where.status?.in ?? [];
          if (statuses.length > 0 && !statuses.includes(asset.status)) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return asset;
        }
      },
      media: {
        count: async () => 0,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updateMedia(data);
          return { count: 1 };
        },
        findUnique: async () => ({ ...media, mediaAsset: asset })
      },
      dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
    };
    const prisma = {
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: tx.media.updateMany,
        update: async ({ data }: { data: Record<string, unknown> }) => updateMedia(data)
      },
      $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: media.album }) } as unknown as AlbumsService;
    const put = vi.fn(async () => undefined);
    const storage = {
      read: async () => ({ bytes: png, contentType: "image/png" }),
      put,
      delete: async () => undefined
    } as unknown as StorageService;

    await expect(new MediaService(prisma, albums, storage).complete("user-1", media.id))
      .resolves.toEqual({ mediaId: media.id, status: "READY" });
    expect(put).toHaveBeenCalledTimes(3);
    expect(asset.status).toBe("READY");
  });

  it("reclaims an abandoned processing upload", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "PROCESSING",
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      tempObjectKey: "temp/family-1/media-1",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null
    };
    const read = vi.fn(async () => {
      throw new Error("STORAGE_UNAVAILABLE");
    });
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          const candidates = (where.OR ?? []) as { status?: string }[];
          const canReclaim = candidates.some((candidate) => candidate.status === "PROCESSING");
          return { count: canReclaim ? 1 : 0 };
        },
        update: async () => ({ ...media, status: "FAILED" })
      }
    } as unknown as PrismaService;
    const storage = { read } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await mediaItems.complete("user-1", "media-1").catch(() => undefined);

    expect(read).toHaveBeenCalledOnce();
  });

  it("does not let a stale worker overwrite a newer completion", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "PROCESSING",
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      tempObjectKey: "temp/family-1/media-1",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null
    };
    let claimedAt: Date | undefined;
    const prisma = {
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async ({ where, data }: {
          where: { OR?: unknown; status?: string; updatedAt?: Date };
          data: { status?: string; updatedAt?: Date };
        }) => {
          if (where.OR) {
            claimedAt = data.updatedAt;
            Object.assign(media, data);
            return { count: 1 };
          }
          const ownsClaim = media.status === where.status && media.updatedAt === where.updatedAt;
          if (ownsClaim) Object.assign(media, data);
          return { count: ownsClaim ? 1 : 0 };
        },
        update: async ({ data }: { data: { status: string } }) => {
          Object.assign(media, data);
          return media;
        }
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        media: {
          updateMany: async ({ where, data }: {
            where: { status?: string; updatedAt?: Date };
            data: Record<string, unknown>;
          }) => {
            const ownsClaim = media.status === where.status && media.updatedAt === where.updatedAt;
            if (ownsClaim) Object.assign(media, data);
            return { count: ownsClaim ? 1 : 0 };
          }
        },
        mediaAsset: { updateMany: async () => ({ count: 0 }) }
      })
    } as unknown as PrismaService;
    const albums = { requireAlbum: async () => ({ album: media.album }) } as unknown as AlbumsService;
    const storage = {
      read: async () => {
        media.status = "READY";
        media.updatedAt = new Date((claimedAt?.getTime() ?? 0) + 1);
        throw new Error("old worker failed");
      }
    } as unknown as StorageService;

    const failure = await new MediaService(prisma, albums, storage).complete("user-1", media.id).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({ code: "MEDIA_STATE_CHANGED" });
    expect(media.status).toBe("READY");
  });

  it("does not let direct completion of a failed upload exceed the daily limit", async () => {
    const media = {
      id: "media-failed",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "FAILED",
      tempObjectKey: "temp/family-1/media-failed",
      album: { familyId: "family-1" },
      mediaAsset: null
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => media,
        updateMany: async () => ({ count: 1 })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          count: async ({ where }: { where: { uploadedById?: string } }) =>
            where.uploadedById ? 0 : 10,
          updateMany: async () => ({ count: 1 })
        }
      })
    } as unknown as PrismaService;
    const read = vi.fn(async () => ({ bytes: png, contentType: "image/png" }));
    const storage = { read } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", media.id).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "DAILY_MEDIA_LIMIT"
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an image above the decoded pixel limit with a stable code", async () => {
    const oversizedJpegHeader = Buffer.from([
      255, 216, 255, 192, 0, 17, 8, 27, 88, 39, 16, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
      255, 218, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 0, 255, 217
    ]);
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null
    };
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        updateMany: async () => ({ count: 1 }),
        update: async () => ({ ...media, status: "FAILED" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        media: { updateMany: async () => ({ count: 1 }) },
        mediaAsset: { updateMany: async () => ({ count: 0 }) }
      })
    } as unknown as PrismaService;
    const storage = {
      read: async () => ({ bytes: oversizedJpegHeader, contentType: "image/jpeg" })
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as BadRequestException).getResponse()).toMatchObject({
      code: "INVALID_IMAGE"
    });
  });

  it("logs cleanup failures and keeps a failed temp cleanup recoverable on the next completion", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "READY",
      tempObjectKey: "temp/family-1/media-1",
      failureReason: "TEMP_OBJECT_CLEANUP_PENDING",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: { id: "asset-1" }
    };
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { ...media };
        }
      }
    } as unknown as PrismaService;
    let deleteAttempts = 0;
    const storage = {
      delete: async () => {
        if (deleteAttempts++ === 0) throw new Error("STORAGE_UNAVAILABLE");
      }
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);
    const warn = vi.spyOn((mediaItems as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, "warn");

    const firstFailure = await mediaItems.complete("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );
    expect((firstFailure as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "MEDIA_CLEANUP_FAILED"
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("임시 객체 정리 실패"));
    await expect(mediaItems.complete("user-1", "media-1")).resolves.toEqual({
      mediaId: "media-1",
      status: "READY"
    });
    expect(media).toMatchObject({ tempObjectKey: null, failureReason: null });
  });

  it("does not process the same upload twice concurrently", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      originalName: "baby.png",
      uploadContentType: "image/png",
      uploadSize: png.length,
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null as string | null,
      failureReason: null as string | null,
      updatedAt: new Date(),
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null as Record<string, unknown> | null
    };
    let asset: Record<string, unknown> | null = null;
    const updateMany = async ({ where, data }: {
      where: { OR?: unknown; status?: string; updatedAt?: Date };
      data: Record<string, unknown>;
    }) => {
      if (where.OR) {
        if (media.status !== "PENDING_UPLOAD") return { count: 0 };
      } else if (
        (where.status && media.status !== where.status)
        || (where.updatedAt && media.updatedAt !== where.updatedAt)
      ) {
        return { count: 0 };
      }
      Object.assign(media, data);
      return { count: 1 };
    };
    const tx = {
      $executeRaw: async () => undefined,
      media: {
        findUnique: async () => ({ ...media, mediaAsset: asset }),
        updateMany
      },
      mediaAsset: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          asset = { id: "asset-1", ...data, updatedAt: new Date() };
          return asset;
        },
        findUnique: async () => asset,
        updateMany: async ({ where, data }: {
          where: { status?: string };
          data: Record<string, unknown>;
        }) => {
          if (!asset || (where.status && asset.status !== where.status)) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        }
      },
      dailyRepresentative: { upsert: async () => ({ id: "representative-1" }) }
    };
    const prisma = {
      media: {
        findUnique: async () => ({ ...media, mediaAsset: asset }),
        updateMany,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { ...media, mediaAsset: asset };
        }
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;
    const albums = {
      requireAlbum: async () => ({ album: media.album, membership: { role: "OWNER" } })
    } as unknown as AlbumsService;
    let signalReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const read = vi.fn(async () => {
      signalReadStarted();
      await readGate;
      return { bytes: png, contentType: "image/png" };
    });
    const put = vi.fn(async () => undefined);
    const storage = { read, put, delete: async () => undefined } as unknown as StorageService;
    const mediaItems = new MediaService(prisma, albums, storage);

    const first = mediaItems.complete("user-1", media.id);
    await readStarted;
    await expect(mediaItems.complete("user-1", media.id)).rejects.toBeInstanceOf(ConflictException);
    releaseRead();
    await expect(first).resolves.toEqual({ mediaId: media.id, status: "READY" });
    expect(read).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledTimes(3);
    expect(asset).toMatchObject({ id: "asset-1", status: "READY" });
    expect(media).toMatchObject({ status: "READY", mediaAssetId: "asset-1" });
  });

  it("rejects a supported MIME type when the decoded image format is unsupported", async () => {
    const media = {
      id: "media-svg",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-svg",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null
    };
    const prisma = {
      album: { findUnique: async () => media.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => media,
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => ({ ...media, ...data })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        media: { updateMany: async () => ({ count: 1 }) },
        mediaAsset: { updateMany: async () => ({ count: 0 }) }
      })
    } as unknown as PrismaService;
    const storage = {
      read: async () => ({
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
        contentType: "image/jpeg"
      })
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", media.id).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as BadRequestException).getResponse()).toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT"
    });
  });

  it("rechecks the daily limit when an upload becomes failed before it is claimed", async () => {
    const baseMedia = {
      id: "media-raced",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      tempObjectKey: "temp/family-1/media-raced",
      album: { familyId: "family-1" },
      mediaAsset: null
    };
    let lookupCount = 0;
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({
          ...baseMedia,
          status: lookupCount++ === 0 ? "PENDING_UPLOAD" : "FAILED"
        }),
        updateMany: async ({ where }: { where: { OR?: Array<{ status?: string | { in?: string[] } }> } }) => {
          const statuses = (where.OR ?? []).flatMap(({ status }) =>
            typeof status === "string" ? [status] : status?.in ?? []
          );
          return { count: statuses.includes("FAILED") ? 1 : 0 };
        },
        update: async () => ({ ...baseMedia, status: "FAILED" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          count: async ({ where }: { where: { uploadedById?: string } }) =>
            where.uploadedById ? 0 : 10,
          updateMany: async () => ({ count: 1 })
        }
      })
    } as unknown as PrismaService;
    const read = vi.fn(async () => {
      throw new Error("SHOULD_NOT_READ");
    });
    const storage = { read } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.complete("user-1", baseMedia.id).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "DAILY_MEDIA_LIMIT"
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns the stable completion response when another request finishes first", async () => {
    const pending = {
      id: "media-1",
      albumId: "album-1",
      uploadedById: "user-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      album: { id: "album-1", familyId: "family-1" },
      mediaAsset: null
    };
    const ready = {
      ...pending,
      status: "READY",
      tempObjectKey: null,
      mediaAsset: {
        originalKey: "assets/family-1/media-1/original",
        displayKey: "assets/family-1/media-1/display.webp",
        thumbnailKey: "assets/family-1/media-1/thumbnail.webp"
      }
    };
    let lookupCount = 0;
    const prisma = {
      album: { findUnique: async () => pending.album },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => lookupCount++ === 0 ? pending : ready,
        updateMany: async () => ({ count: 0 })
      }
    } as unknown as PrismaService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, {} as StorageService);

    await expect(mediaItems.complete("user-1", "media-1")).resolves.toEqual({
      mediaId: "media-1",
      status: "READY"
    });
  });

  it("limits concurrent processing to two media files", async () => {
    const pending = Array.from({ length: 3 }, () => {
      let reject!: (reason: Error) => void;
      const promise = new Promise<never>((_, rejectPromise) => { reject = rejectPromise; });
      return { promise, reject };
    });
    const read = vi.fn(() => pending[read.mock.calls.length - 1].promise);
    const media = (id: string) => ({
      id,
      albumId: "album-1",
      albumDate: new Date("2026-08-01T00:00:00.000Z"),
      uploadedById: "user-1",
      tempObjectKey: `temp/${id}`,
      status: "PENDING_UPLOAD",
      album: { familyId: "family-1" },
      mediaAsset: null
    });
    const prisma = {
      media: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media(where.id)),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      }
    } as unknown as PrismaService;
    const albums = { requireAlbum: vi.fn(async () => undefined) } as unknown as AlbumsService;
    const storage = { read } as unknown as StorageService;
    const mediaItems = new MediaService(prisma, albums, storage);

    const completions = ["media-1", "media-2", "media-3"].map((id) => mediaItems.complete("user-1", id));
    const settled = Promise.allSettled(completions);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    pending[0].reject(new Error("stop"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    pending[1].reject(new Error("stop"));
    pending[2].reject(new Error("stop"));
    await settled;
  });
});

describe("media storage limits", () => {
  it("rejects the downloaded bytes when they exceed the upload limit", async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    const body = {
      transformToByteArray: async () => oversized,
      async *[Symbol.asyncIterator]() {
        yield oversized;
      }
    };
    let requestCount = 0;
    const storage = Object.create(StorageService.prototype) as StorageService;
    Object.assign(storage, {
      config: { bucket: "test-bucket" },
      client: {
        send: async () =>
          requestCount++ === 0
            ? { ContentLength: 1, ContentType: "image/png" }
            : { Body: body }
      }
    });

    const failure = await storage.read("temp/family-1/media-1").then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toMatchObject({ message: "FILE_TOO_LARGE" });
  });
});

describe("media upload idempotency", () => {
  it("rejects an upload id already owned by another family member", async () => {
    const existing = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "other-user",
      originalName: "baby.jpg",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "MEMBER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: { findUnique: async () => existing }
      })
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "baby.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "UPLOAD_ID_CONFLICT"
    });
  });

  it("rejects an upload id reused for different media metadata", async () => {
    const existing = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "first.jpg",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: { findUnique: async () => existing }
      })
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "second.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "UPLOAD_ID_CONFLICT"
    });
  });

  it("rejects an upload id reused with a different content type", async () => {
    const existing = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.mp4",
      uploadContentType: "video/mp4",
      uploadSize: 1024,
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: { findUnique: async () => existing }
      })
    } as unknown as PrismaService;
    const storage = {
      presignUpload: vi.fn(async () => "https://storage.example/upload")
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaService = new MediaService(prisma, albums, storage);

    const failure = await mediaService.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "baby.mp4",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "UPLOAD_ID_CONFLICT"
    });
  });

  it("does not let a failed upload retry exceed the daily media limit", async () => {
    const existing = {
      id: "media-failed",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.jpg",
      uploadContentType: "image/jpeg",
      uploadSize: 1024,
      status: "FAILED",
      tempObjectKey: "temp/family-1/media-failed",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          findUnique: async () => existing,
          count: async ({ where }: { where: { uploadedById?: string } }) =>
            where.uploadedById ? 0 : 10,
          update: async () => existing
        }
      })
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "baby.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "DAILY_MEDIA_LIMIT"
    });
  });

  it("does not issue another PUT URL while an upload is processing", async () => {
    const existing = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.jpg",
      uploadContentType: "image/jpeg",
      uploadSize: 1024,
      status: "PROCESSING",
      tempObjectKey: "temp/family-1/media-1",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: { findUnique: async () => existing }
      })
    } as unknown as PrismaService;
    const presignUpload = vi.fn(async () => "https://storage.example/upload");
    const storage = { presignUpload } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "baby.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    })).resolves.toMatchObject({ status: "PROCESSING", uploadUrl: null });
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it("lets the uploader retry an upload after abandoned-file cleanup", async () => {
    const existing = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      originalName: "baby.jpg",
      uploadContentType: "image/jpeg",
      uploadSize: 1024,
      status: "DELETED",
      tempObjectKey: null,
      mediaAssetId: null,
      failureReason: "UPLOAD_EXPIRED",
      capturedAt: null,
      dateSource: "USER",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          findUnique: async () => existing,
          count: async () => 0,
          update: async ({ data }: { data: Record<string, unknown> }) => ({
            ...existing,
            ...data,
            childTags: []
          })
        }
      })
    } as unknown as PrismaService;
    const storage = {
      presignUpload: vi.fn(async () => "https://storage.example/upload")
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "baby.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "1d3df46c-72dc-4d7b-9d51-3da82a4c61ce"
    })).resolves.toMatchObject({
      mediaId: "media-1",
      status: "PENDING_UPLOAD",
      uploadUrl: "https://storage.example/upload"
    });
  });

  it("retires an expired upload key before issuing a new upload", async () => {
    const stale = {
      id: "media-stale",
      tempObjectKey: "temp/family-1/old-key",
      status: "PENDING_UPLOAD"
    };
    const created = {
      id: "media-new",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      capturedAt: null,
      dateSource: "USER",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/new-key",
      childTags: []
    };
    let expiredStatus = "";
    const clearExpiredKey = vi.fn(async () => ({ ...stale, status: "DELETED", tempObjectKey: null }));
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { update: clearExpiredKey },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          findUnique: async () => null,
          findMany: async () => [stale],
          updateMany: async ({ data }: { data: { status: string } }) => {
            expiredStatus = data.status;
            return { count: 1 };
          },
          count: async () => 0,
          create: async () => created
        }
      })
    } as unknown as PrismaService;
    const storage = {
      delete: vi.fn(async () => undefined),
      presignUpload: vi.fn(async () => "https://storage.example/upload")
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "new.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "4f37028b-a575-42c4-8b78-b67b2c41df3e"
    });

    expect(expiredStatus).toBe("DELETED");
    expect(storage.delete).toHaveBeenCalledWith(stale.tempObjectKey);
    expect(clearExpiredKey).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: stale.id },
      data: expect.objectContaining({ tempObjectKey: null, failureReason: "UPLOAD_EXPIRED" })
    }));
  });

  it("does not delete an expired candidate reclaimed by another completion", async () => {
    const stale = {
      id: "media-reclaimed",
      tempObjectKey: "temp/family-1/reclaimed-key",
      status: "PROCESSING"
    };
    const created = {
      id: "media-new",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      capturedAt: null,
      dateSource: "USER",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/new-key",
      childTags: []
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { update: vi.fn() },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        media: {
          findUnique: async () => null,
          findMany: async () => [stale],
          updateMany: async () => ({ count: 0 }),
          count: async () => 1,
          create: async () => created
        }
      })
    } as unknown as PrismaService;
    const storage = {
      delete: vi.fn(async () => undefined),
      presignUpload: vi.fn(async () => "https://storage.example/upload")
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await mediaItems.startUpload("user-1", "album-1", {
      date: "2026-08-03",
      originalName: "new.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
      clientUploadId: "93f556b0-9618-4ae9-961f-621a29124e3b"
    });

    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe("private media URL authorization", () => {
  it("rejects an unknown image variant before querying storage", async () => {
    const findFirst = vi.fn();
    const presignDownload = vi.fn();
    const prisma = { media: { findFirst } } as unknown as PrismaService;
    const storage = { presignDownload } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.url("user-1", "media-1", "unknown" as "thumbnail")).rejects.toMatchObject({
      response: { code: "INVALID_MEDIA_VARIANT" }
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(presignDownload).not.toHaveBeenCalled();
  });

  it("authorizes a ready media and its family membership in one lookup", async () => {
    const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const album = where.album as {
        family?: { members?: { some?: { userId?: string } } };
      };
      if (album.family?.members?.some?.userId !== "user-1") return null;
      return {
        originalName: "baby.jpg",
        mediaAsset: {
          originalKey: "assets/family-1/media-1/original",
          displayKey: "assets/family-1/media-1/display.webp",
          thumbnailKey: "assets/family-1/media-1/thumbnail.webp"
        }
      };
    });
    const prisma = { media: { findFirst } } as unknown as PrismaService;
    const storage = {
      presignDownload: async () => "https://storage.example/media"
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.url("user-1", "media-1", "thumbnail")).resolves.toEqual({
      url: "https://storage.example/media"
    });
    await expect(mediaItems.url("other-user", "media-1", "thumbnail")).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("daily representative serialization", () => {
  it("checks readiness and writes the representative under the date lock", async () => {
    let locked = false;
    const representative = { id: "representative-1", mediaId: "media-1" };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => {
          locked = true;
        },
        media: {
          findFirst: async () => locked ? { id: "media-1" } : null
        },
        dailyRepresentative: {
          upsert: async () => {
            if (!locked) throw new Error("DATE_NOT_LOCKED");
            return representative;
          }
        }
      })
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(
      mediaItems.setRepresentative("user-1", "album-1", "2026-08-03", "media-1")
    ).resolves.toEqual(representative);
    expect(locked).toBe(true);
  });
});

describe("unfinished media deletion", () => {
  it("deletes only the owned asset and keeps repeated cleanup idempotent", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "READY",
      tempObjectKey: null,
      mediaAssetId: "asset-1"
    };
    let transactionActive = false;
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "READY",
      updatedAt: new Date()
    };
    const deleteAsset = vi.fn(async () => ({ id: "asset-1" }));
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { findUnique: async () => ({ ...media }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        transactionActive = true;
        try {
          return await work({
            $executeRaw: async () => undefined,
            dailyRepresentative: {
              deleteMany: async () => ({ count: 0 }),
              create: async () => ({ id: "representative-1" })
            },
            media: {
              count: async () => 0,
              updateMany: async ({ data }: { data: Record<string, unknown> }) => {
                Object.assign(media, data);
                return { count: 1 };
              },
              findFirst: async () => null
            },
            mediaAsset: {
              findUnique: async () => asset,
              updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
                if (where.status && asset.status !== where.status) return { count: 0 };
                Object.assign(asset, data);
                return { count: 1 };
              },
              update: async ({ data }: { data: { status: "READY" | "ORPHANED" | "DELETING" } }) => {
                asset.status = data.status;
                return asset;
              },
              delete: deleteAsset
            }
          });
        } finally {
          transactionActive = false;
        }
      }
    } as unknown as PrismaService;
    const deleteObject = vi.fn(async () => {
      expect(transactionActive).toBe(false);
      expect(asset.status).toBe("DELETING");
    });
    const storage = { delete: deleteObject } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.remove("user-1", media.id)).resolves.toEqual({ ok: true });
    await expect(mediaItems.remove("user-1", media.id)).resolves.toEqual({ ok: true });
    expect(deleteObject).toHaveBeenCalledTimes(3);
    expect(deleteAsset).toHaveBeenCalledOnce();
  });

  it("reports logical deletion as successful when storage cleanup is pending", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "READY",
      tempObjectKey: null,
      mediaAssetId: "asset-1"
    };
    const asset = {
      id: "asset-1",
      familyId: "family-1",
      originalKey: "assets/family-1/media-1/original",
      displayKey: "assets/family-1/media-1/display.webp",
      thumbnailKey: "assets/family-1/media-1/thumbnail.webp",
      status: "READY",
      updatedAt: new Date()
    };
    const tx = {
      $executeRaw: async () => undefined,
      dailyRepresentative: {
        deleteMany: async () => ({ count: 0 }),
        create: async () => ({ id: "representative-1" })
      },
      media: {
        count: async () => 0,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { count: 1 };
        },
        findFirst: async () => null
      },
      mediaAsset: {
        findUnique: async () => asset,
        updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
          if (where.status && asset.status !== where.status) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return asset;
        }
      }
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { findUnique: async () => ({ ...media }) },
      mediaAsset: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(asset, data);
          return { count: 1 };
        }
      },
      $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx)
    } as unknown as PrismaService;
    const storage = {
      delete: async () => { throw new Error("storage unavailable"); }
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);

    await expect(new MediaService(prisma, albums, storage).remove("user-1", media.id))
      .resolves.toEqual({ ok: true, cleanupPending: true });
    expect(media.status).toBe("DELETED");
    expect(asset.status).toBe("ORPHANED");
  });

  it("rejects deleting a media while it is processing", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "PROCESSING",
      tempObjectKey: "temp/family-1/media-1",
      failureReason: null
    };
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
      dailyRepresentative: {
        deleteMany: async () => ({ count: 0 }),
        create: async () => ({ id: "representative-1" })
      },
      media: {
        update: async () => ({ ...media, status: "DELETED" }),
        findFirst: async () => null
      }
    }));
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { findUnique: async () => ({ ...media }) },
      $transaction: transaction
    } as unknown as PrismaService;
    const storage = { delete: async () => undefined } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.remove("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "MEDIA_PROCESSING"
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("preserves processing when the state changes before deletion commits", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      failureReason: null
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { findUnique: async () => ({ ...media }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        media.status = "PROCESSING";
        return work({
          $executeRaw: async () => undefined,
          dailyRepresentative: {
            deleteMany: async () => ({ count: 0 }),
            create: async () => ({ id: "representative-1" })
          },
          media: {
            update: async () => {
              media.status = "DELETED";
              return { ...media };
            },
            updateMany: async () => ({ count: 0 }),
            findFirst: async () => null
          }
        });
      }
    } as unknown as PrismaService;
    const deleteObject = vi.fn(async () => undefined);
    const storage = { delete: deleteObject } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    const failure = await mediaItems.remove("user-1", "media-1").then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "MEDIA_STATE_CHANGED"
    });
    expect(media.status).toBe("PROCESSING");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("does not replace the representative when deleting a different media", async () => {
    const media = {
      id: "media-2",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "READY",
      tempObjectKey: null
    };
    const createRepresentative = vi.fn(async () => ({ id: "representative-2" }));
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: { findUnique: async () => ({ ...media }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        dailyRepresentative: {
          deleteMany: async () => ({ count: 0 }),
          create: createRepresentative
        },
        media: {
          updateMany: async () => ({ count: 1 }),
          findFirst: async () => ({ id: "media-1" })
        }
      })
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.remove("user-1", "media-2")).resolves.toEqual({ ok: true });
    expect(createRepresentative).not.toHaveBeenCalled();
  });

  it("keeps a failed temp deletion recoverable on the next request", async () => {
    const media = {
      id: "media-1",
      albumId: "album-1",
      albumDate: new Date("2026-08-03T00:00:00.000Z"),
      uploadedById: "user-1",
      status: "PENDING_UPLOAD",
      tempObjectKey: "temp/family-1/media-1",
      failureReason: null as string | null
    };
    const updateMedia = ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(media, data);
      return { ...media };
    };
    const prisma = {
      album: {
        findUnique: async () => ({ id: "album-1", familyId: "family-1", name: "우리의 여름" })
      },
      familyMember: {
        findUnique: async () => ({ familyId: "family-1", userId: "user-1", role: "OWNER" })
      },
      media: {
        findUnique: async () => ({ ...media }),
        update: async (args: { data: Record<string, unknown> }) => updateMedia(args)
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
        $executeRaw: async () => undefined,
        dailyRepresentative: {
          deleteMany: async () => ({ count: 0 }),
          create: async () => ({ id: "representative-1" })
        },
        media: {
          update: async (args: { data: Record<string, unknown> }) => updateMedia(args),
          updateMany: async (args: { data: Record<string, unknown> }) => {
            updateMedia(args);
            return { count: 1 };
          },
          findFirst: async () => null
        }
      })
    } as unknown as PrismaService;
    let deleteAttempts = 0;
    const storage = {
      delete: async () => {
        if (deleteAttempts++ === 0) throw new Error("STORAGE_UNAVAILABLE");
      }
    } as unknown as StorageService;
    const families = new FamiliesService(prisma);
    const albums = new AlbumsService(prisma, families);
    const mediaItems = new MediaService(prisma, albums, storage);

    await expect(mediaItems.remove("user-1", "media-1"))
      .resolves.toEqual({ ok: true, cleanupPending: true });
    await expect(mediaItems.remove("user-1", "media-1")).resolves.toEqual({ ok: true });
    expect(media).toMatchObject({
      status: "DELETED",
      tempObjectKey: null,
      failureReason: null
    });
  });

  it("resumes abandoned upload cleanup when the media service starts", async () => {
    const media = {
      id: "media-1",
      status: "FAILED",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null,
      updatedAt: new Date(0)
    };
    const prisma = {
      media: {
        findMany: async () => [{ ...media }],
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { ...media };
        }
      }
    } as unknown as PrismaService;
    const storage = { delete: vi.fn(async () => undefined) } as unknown as StorageService;
    const service = new MediaService(prisma, {} as AlbumsService, storage);

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(storage.delete).toHaveBeenCalledWith("temp/family-1/media-1");
      expect(media).toMatchObject({
        status: "DELETED",
        tempObjectKey: null,
        failureReason: "UPLOAD_EXPIRED"
      });
    });
    service.onModuleDestroy();
  });

  it("retries a deleted media's pending cleanup when the media service starts", async () => {
    const media = {
      id: "media-1",
      status: "DELETED",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null,
      updatedAt: new Date()
    };
    const prisma = {
      media: {
        findMany: async () => [{ ...media }],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { ...media };
        }
      }
    } as unknown as PrismaService;
    const storage = { delete: vi.fn(async () => undefined) } as unknown as StorageService;
    const service = new MediaService(prisma, {} as AlbumsService, storage);

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(storage.delete).toHaveBeenCalledWith("temp/family-1/media-1");
      expect(media.tempObjectKey).toBeNull();
    });
    service.onModuleDestroy();
  });

  it("retries temp cleanup for a ready media without deleting the media", async () => {
    const media = {
      id: "media-1",
      status: "READY",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: "asset-1",
      failureReason: "TEMP_OBJECT_CLEANUP_PENDING",
      updatedAt: new Date()
    };
    const prisma = {
      media: {
        findMany: async () => [{ ...media }],
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(media, data);
          return { ...media };
        }
      }
    } as unknown as PrismaService;
    const storage = { delete: vi.fn(async () => undefined) } as unknown as StorageService;
    const service = new MediaService(prisma, {} as AlbumsService, storage);

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(media).toMatchObject({
        status: "READY",
        tempObjectKey: null,
        failureReason: null
      });
    });
    service.onModuleDestroy();
  });

  it("moves a failed cleanup behind other queued mediaItems", async () => {
    const updates: Record<string, unknown>[] = [];
    const media = {
      id: "media-1",
      status: "DELETED",
      tempObjectKey: "temp/family-1/media-1",
      mediaAssetId: null,
      updatedAt: new Date(0)
    };
    const prisma = {
      media: {
        findMany: async () => [{ ...media }],
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { ...media, ...data };
        }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        })
      }
    } as unknown as PrismaService;
    const storage = {
      delete: vi.fn(async () => { throw new Error("storage unavailable"); })
    } as unknown as StorageService;
    const service = new MediaService(prisma, {} as AlbumsService, storage);

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(updates).toContainEqual({ failureReason: "MEDIA_CLEANUP_PENDING" });
    });
    service.onModuleDestroy();
  });

  it("does not block application startup while cleanup is waiting", async () => {
    let release!: (mediaItems: never[]) => void;
    const waiting = new Promise<never[]>((resolve) => { release = resolve; });
    const service = new MediaService({
      media: { findMany: () => waiting }
    } as unknown as PrismaService, {} as AlbumsService, {} as StorageService);

    const initialization = service.onModuleInit();
    release([]);
    await Promise.resolve(initialization);
    service.onModuleDestroy();

    expect(initialization).toBeUndefined();
  });
});
