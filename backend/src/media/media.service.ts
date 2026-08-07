import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaService } from "../common/prisma.service.js";
import { parseAlbumDate } from "../common/album-date.js";
import { env } from "../common/env.js";
import {
  EMPTY_MEDIA_FILTER,
  mediaFilterWhere,
  type MediaFilter
} from "../common/media-filter.js";
import { AlbumsService } from "../albums/albums.service.js";
import { assertActiveUploadCapacity, assertDailyMediaCapacity, canDeleteMedia } from "./policies.js";
import { StorageObjectError, StorageService } from "./storage.service.js";
import type { StartUploadDto } from "./media.dto.js";
import {
  InvalidVideoError,
  processMp4,
  VideoProcessorUnavailableError
} from "./video-processor.js";

const ACTIVE_STATUSES = ["PENDING_UPLOAD", "PROCESSING", "READY"] as const;
const ACTIVE_UPLOAD_STATUSES = ["PENDING_UPLOAD", "PROCESSING"] as const;
const UPLOAD_EXPIRY_MS = 30 * 60 * 1000;
const ASSET_DELETION_EXPIRY_MS = 2 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 25;
const MAX_IMAGE_PIXELS = 60_000_000;
const MAX_CONCURRENT_MEDIA_PROCESSING = 2;
let activeMediaProcessing = 0;
const mediaProcessingWaiters: Array<() => void> = [];

async function acquireMediaProcessingSlot(): Promise<() => void> {
  if (activeMediaProcessing >= MAX_CONCURRENT_MEDIA_PROCESSING) {
    await new Promise<void>((resolve) => mediaProcessingWaiters.push(resolve));
  } else {
    activeMediaProcessing += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = mediaProcessingWaiters.shift();
    if (next) next();
    else activeMediaProcessing -= 1;
  };
}

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly albums: AlbumsService,
    private readonly storage: StorageService
  ) {}

  onModuleInit(): void {
    // ponytail: each API replica runs this idempotent DB-backed sweep; use a dedicated worker only if cleanup volume grows.
    this.cleanupTimer = setInterval(() => void this.cleanupAbandonedMedia(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
    void this.cleanupAbandonedMedia();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async cleanupAbandonedMedia(): Promise<void> {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      const uploadCutoff = new Date(Date.now() - UPLOAD_EXPIRY_MS);
      const deletionCutoff = new Date(Date.now() - ASSET_DELETION_EXPIRY_MS);
      const mediaItems = await this.prisma.media.findMany({
        where: {
          OR: [
            {
              status: { in: ["PENDING_UPLOAD", "PROCESSING", "FAILED"] },
              tempObjectKey: { not: null },
              updatedAt: { lt: uploadCutoff }
            },
            { status: "READY", tempObjectKey: { not: null } },
            { status: "DELETED", tempObjectKey: { not: null } },
            { status: "DELETED", mediaAsset: { is: { status: { in: ["READY", "ORPHANED", "UPLOADING"] } } } },
            {
              status: "DELETED",
              mediaAsset: { is: { status: "DELETING", updatedAt: { lt: deletionCutoff } } }
            }
          ]
        },
        select: {
          id: true,
          status: true,
          tempObjectKey: true,
          mediaAssetId: true,
          uploadedById: true,
          failureReason: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "asc" },
        take: CLEANUP_BATCH_SIZE
      });
      for (const media of mediaItems) {
        if (media.status === "PROCESSING") {
          void this.complete(media.uploadedById, media.id).catch(() => {
            this.logger.warn("중단된 미디어 처리를 재개하지 못했습니다. 다음 주기에 다시 시도합니다.");
          });
          continue;
        }
        if (media.status === "READY") {
          try {
            await this.cleanupTempObject(media);
          } catch (error) {
            if (!(error instanceof ServiceUnavailableException)) throw error;
          }
          continue;
        }
        const expiredUpload = media.status !== "DELETED" || media.failureReason === "UPLOAD_EXPIRED";
        if (media.status !== "DELETED") {
          const claimed = await this.prisma.media.updateMany({
            where: { id: media.id, status: media.status, updatedAt: { lt: uploadCutoff } },
            data: { status: "DELETED", failureReason: "UPLOAD_EXPIRED" }
          });
          if (claimed.count === 0) continue;
        }
        let cleanupPending = false;
        try {
          await this.cleanupTempObject(media, expiredUpload ? "UPLOAD_EXPIRED" : null);
        } catch (error) {
          if (!(error instanceof ServiceUnavailableException)) throw error;
          cleanupPending = true;
        }
        try {
          await this.cleanupMediaAsset(media.mediaAssetId);
        } catch (error) {
          if (!(error instanceof ServiceUnavailableException)) throw error;
          cleanupPending = true;
        }
        if (cleanupPending) {
          await this.prisma.media.updateMany({
            where: { id: media.id, status: "DELETED" },
            data: { failureReason: expiredUpload ? "UPLOAD_EXPIRED" : "MEDIA_CLEANUP_PENDING" }
          });
        }
      }
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      this.logger.warn(`보류된 미디어 정리를 완료하지 못했습니다. 다음 주기에 다시 시도합니다: ${cause}`);
    } finally {
      this.cleanupRunning = false;
    }
  }

  async startUpload(userId: string, albumId: string, dto: StartUploadDto) {
    const { album } = await this.albums.requireAlbum(userId, albumId);
    const childTagIds = [...new Set(dto.childTagIds ?? [])];
    const albumDate = parseAlbumDate(dto.date);

    const { media, expiredMedia } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upload-user:${userId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${albumId}:${dto.date}`}))`;
      let existing = await tx.media.findUnique({
        where: { albumId_clientUploadId: { albumId, clientUploadId: dto.clientUploadId } },
        include: { childTags: { include: { childTag: true } } }
      });
      if (existing) {
        const existingTagIds = existing.childTags.map(({ childTag }) => childTag.id).sort();
        const requestedTagIds = [...childTagIds].sort();
        const sameRequest =
          existing.uploadedById === userId &&
          existing.albumDate.getTime() === albumDate.getTime() &&
          existing.originalName === dto.originalName &&
          existing.uploadContentType === dto.contentType &&
          existing.uploadSize === dto.fileSize &&
          (existing.capturedAt?.getTime() ?? null) ===
            (dto.capturedAt ? new Date(dto.capturedAt).getTime() : null) &&
          existing.dateSource === (dto.dateSource ?? "USER") &&
          existingTagIds.length === requestedTagIds.length &&
          existingTagIds.every((id, index) => id === requestedTagIds[index]);
        if (!sameRequest) {
          throw new ConflictException({
            code: "UPLOAD_ID_CONFLICT",
            message: "이미 다른 업로드에 사용된 식별자입니다."
          });
        }
        const retryExpiredUpload =
          existing.status === "DELETED" &&
          existing.failureReason === "UPLOAD_EXPIRED" &&
          !existing.tempObjectKey &&
          !existing.mediaAssetId;
        if (existing.status === "FAILED" || retryExpiredUpload) {
          const userActiveCount = await tx.media.count({
            where: { uploadedById: userId, status: { in: [...ACTIVE_UPLOAD_STATUSES] } }
          });
          assertActiveUploadCapacity(userActiveCount, env.maxActiveUploadsPerUser);
          const activeCount = await tx.media.count({
            where: { albumId, albumDate, status: { in: [...ACTIVE_STATUSES] } }
          });
          assertDailyMediaCapacity(activeCount);
          existing = await tx.media.update({
            where: { id: existing.id },
            data: {
              status: "PENDING_UPLOAD",
              tempObjectKey: retryExpiredUpload
                ? `temp/${album.familyId}/${randomUUID()}`
                : existing.tempObjectKey,
              failureReason: null
            },
            include: { childTags: { include: { childTag: true } } }
          });
        }
        return {
          media: existing,
          expiredMedia: [] as Array<{ id: string; tempObjectKey: string | null }>
        };
      }
      if (childTagIds.length) {
        const validTagCount = await tx.childTag.count({
          where: { albumId, id: { in: childTagIds } }
        });
        if (validTagCount !== childTagIds.length) {
          throw new BadRequestException({
            code: "INVALID_CHILD_TAG",
            message: "이 앨범에 등록된 아이 태그만 선택할 수 있습니다."
          });
        }
      }
      const uploadCutoff = new Date(Date.now() - UPLOAD_EXPIRY_MS);
      const stale = await tx.media.findMany({
        where: {
          albumId,
          albumDate,
          status: { in: ["PENDING_UPLOAD", "PROCESSING"] },
          updatedAt: { lt: uploadCutoff }
        },
        select: { id: true, tempObjectKey: true }
      });
      const expiredMedia: typeof stale = [];
      for (const candidate of stale) {
        const expired = await tx.media.updateMany({
          where: {
            id: candidate.id,
            status: { in: ["PENDING_UPLOAD", "PROCESSING"] },
            updatedAt: { lt: uploadCutoff }
          },
          data: { status: "DELETED", failureReason: "UPLOAD_EXPIRED" }
        });
        if (expired.count) expiredMedia.push(candidate);
      }
      const userActiveCount = await tx.media.count({
        where: { uploadedById: userId, status: { in: [...ACTIVE_UPLOAD_STATUSES] } }
      });
      assertActiveUploadCapacity(userActiveCount, env.maxActiveUploadsPerUser);
      const activeCount = await tx.media.count({
        where: { albumId, albumDate, status: { in: [...ACTIVE_STATUSES] } }
      });
      assertDailyMediaCapacity(activeCount);
      const created = await tx.media.create({
        data: {
          albumId,
          uploadedById: userId,
          albumDate,
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : null,
          dateSource: dto.dateSource ?? "USER",
          clientUploadId: dto.clientUploadId,
          originalName: dto.originalName,
          uploadContentType: dto.contentType,
          uploadSize: dto.fileSize,
          tempObjectKey: `temp/${album.familyId}/${randomUUID()}`,
          status: "PENDING_UPLOAD",
          childTags: childTagIds.length
            ? { createMany: { data: childTagIds.map((childTagId) => ({ childTagId })) } }
            : undefined
        },
        include: { childTags: { include: { childTag: true } } }
      });
      return {
        media: created,
        expiredMedia
      };
    });

    await Promise.allSettled(
      expiredMedia.map((expiredMedia) => this.cleanupTempObject(
        { ...expiredMedia, status: "DELETED" },
        "UPLOAD_EXPIRED"
      ))
    );

    const childTags = media.childTags.map((item) => item.childTag);
    const metadata = { capturedAt: media.capturedAt, dateSource: media.dateSource };
    if (!media.tempObjectKey || !["PENDING_UPLOAD", "FAILED"].includes(media.status)) {
      return { mediaId: media.id, status: media.status, uploadUrl: null, childTags, ...metadata };
    }
    return {
      mediaId: media.id,
      status: media.status,
      uploadUrl: await this.storage.presignUpload(media.tempObjectKey, dto.contentType, dto.fileSize),
      childTags,
      ...metadata
    };
  }

  async status(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, albumId: true, status: true, failureReason: true }
    });
    if (!media) throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "미디어를 찾을 수 없습니다." });
    await this.albums.requireAlbum(userId, media.albumId);
    return { mediaId: media.id, status: media.status, failureReason: media.failureReason };
  }

  async queueCompletion(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        albumId: true,
        uploadedById: true,
        tempObjectKey: true,
        status: true,
        updatedAt: true
      }
    });
    if (!media) throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "미디어를 찾을 수 없습니다." });
    await this.albums.requireAlbum(userId, media.albumId);
    if (media.status === "READY") return { mediaId: media.id, status: media.status };
    if (media.uploadedById !== userId || !media.tempObjectKey) {
      throw new ForbiddenException({ code: "UPLOAD_OWNER_REQUIRED", message: "업로드한 사용자만 완료할 수 있습니다." });
    }
    const processingIsFresh = media.status === "PROCESSING"
      && media.updatedAt >= new Date(Date.now() - UPLOAD_EXPIRY_MS);
    if (!processingIsFresh) {
      void this.complete(userId, mediaId).catch(() => {
        this.logger.warn("미디어 비동기 처리를 완료하지 못했습니다. 상태 조회에서 실패 사유를 반환합니다.");
      });
    }
    return { mediaId: media.id, status: "PROCESSING" };
  }

  async complete(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      include: { album: true, mediaAsset: true }
    });
    if (!media) throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "미디어를 찾을 수 없습니다." });
    await this.albums.requireAlbum(userId, media.albumId);
    if (media.status === "READY") {
      const ready = await this.cleanupTempObject(media);
      return { mediaId: ready.id, status: ready.status };
    }
    if (media.uploadedById !== userId || !media.tempObjectKey) {
      throw new ForbiddenException({ code: "UPLOAD_OWNER_REQUIRED", message: "업로드한 사용자만 완료할 수 있습니다." });
    }

    // ponytail: process-local gate; move processing to a shared queue when API instances scale horizontally.
    const releaseMediaProcessingSlot = await acquireMediaProcessingSlot();
    let cleanupVideoSource: (() => Promise<void>) | undefined;
    let assetIdForRecovery: string | null = null;
    let assetNeedsUpload = false;
    try {
    const claimTime = new Date();
    const claimMedia = (tx: PrismaService, allowFailed = false) => tx.media.updateMany({
      where: {
        id: media.id,
        OR: [
          { status: allowFailed ? { in: ["PENDING_UPLOAD", "FAILED"] } : "PENDING_UPLOAD" },
          {
            status: "PROCESSING",
            updatedAt: { lt: new Date(Date.now() - UPLOAD_EXPIRY_MS) }
          }
        ],
        tempObjectKey: { not: null }
      },
      data: { status: "PROCESSING", failureReason: null, updatedAt: claimTime }
    });
    const claimFailedMedia = () => this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upload-user:${userId}`}))`;
      const lockKey = `${media.albumId}:${media.albumDate.toISOString().slice(0, 10)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const userActiveCount = await tx.media.count({
        where: { uploadedById: userId, status: { in: [...ACTIVE_UPLOAD_STATUSES] } }
      });
      assertActiveUploadCapacity(userActiveCount, env.maxActiveUploadsPerUser);
      const activeCount = await tx.media.count({
        where: { albumId: media.albumId, albumDate: media.albumDate, status: { in: [...ACTIVE_STATUSES] } }
      });
      assertDailyMediaCapacity(activeCount);
      return claimMedia(tx as PrismaService, true);
    });
    let claim = media.status === "FAILED"
      ? await claimFailedMedia()
      : await claimMedia(this.prisma);
    if (claim.count === 0) {
      const current = await this.prisma.media.findUnique({
        where: { id: media.id },
        include: { album: true, mediaAsset: true }
      });
      if (current?.status === "READY") {
        const ready = await this.cleanupTempObject(current);
        return { mediaId: ready.id, status: ready.status };
      }
      if (current?.status === "FAILED" && current.tempObjectKey) {
        claim = await claimFailedMedia();
      }
    }
    if (claim.count === 0) {
      throw new ConflictException({
        code: "MEDIA_PROCESSING",
        message: "미디어를 이미 처리하고 있습니다."
      });
    }
    try {
      let sourceBytes: Buffer | null = null;
      let videoSource: Awaited<ReturnType<StorageService["readVideo"]>> | null = null;
      if (media.uploadContentType === "video/mp4") {
        videoSource = await this.storage.readVideo(media.tempObjectKey);
        cleanupVideoSource = videoSource.cleanup;
      } else {
        const source = await this.storage.read(media.tempObjectKey);
        sourceBytes = source.bytes;
      }
      const prefix = `assets/${media.album.familyId}/${media.id}`;
      let mimeType: string;
      let width: number;
      let height: number;
      let display: Buffer | null;
      let thumbnail: Buffer;
      let originalKey: string;
      let displayKey: string;
      const thumbnailKey = `${prefix}/thumbnail.webp`;

      if (videoSource) {
        try {
          const video = await processMp4(videoSource.path);
          mimeType = video.mimeType;
          width = video.width;
          height = video.height;
          thumbnail = video.thumbnail;
        } catch (error) {
          if (error instanceof VideoProcessorUnavailableError) {
            throw new ServiceUnavailableException({
              code: "VIDEO_PROCESSOR_UNAVAILABLE",
              message: "영상 처리기를 사용할 수 없습니다. 잠시 후 다시 시도해주세요."
            });
          }
          if (error instanceof InvalidVideoError) {
            throw new BadRequestException({
              code: "INVALID_VIDEO",
              message: "H.264 영상과 AAC 음성을 사용하는 MP4 파일만 올릴 수 있습니다."
            });
          }
          throw error;
        }
        originalKey = `${prefix}/original.mp4`;
        displayKey = originalKey;
        display = null;
      } else {
        if (!sourceBytes) throw new StorageObjectError("EMPTY_OBJECT");
        let metadata;
        try {
          metadata = await sharp(sourceBytes, {
            failOn: "error",
            limitInputPixels: MAX_IMAGE_PIXELS
          }).metadata();
        } catch {
          throw new BadRequestException({ code: "INVALID_IMAGE", message: "올바른 이미지 파일이 아닙니다." });
        }
        if (!metadata.width || !metadata.height || !metadata.format) {
          throw new BadRequestException({ code: "INVALID_IMAGE", message: "올바른 이미지 파일이 아닙니다." });
        }
        if (!["jpeg", "png", "webp"].includes(metadata.format)) {
          throw new BadRequestException({
            code: "UNSUPPORTED_IMAGE_FORMAT",
            message: "JPG, PNG, WebP 사진 또는 MP4 영상만 올릴 수 있습니다."
          });
        }
        if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
          throw new BadRequestException({
            code: "IMAGE_TOO_LARGE",
            message: "이미지 해상도가 너무 큽니다."
          });
        }

        const sharpOptions = {
          failOn: "error" as const,
          limitInputPixels: MAX_IMAGE_PIXELS,
          sequentialRead: true
        };
        try {
          display = await sharp(sourceBytes, sharpOptions)
            .rotate()
            .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 84 })
            .toBuffer();
          thumbnail = await sharp(sourceBytes, sharpOptions)
            .rotate()
            .resize(320, 320, { fit: "cover" })
            .webp({ quality: 78 })
            .toBuffer();
        } catch {
          throw new BadRequestException({ code: "INVALID_IMAGE", message: "올바른 이미지 파일이 아닙니다." });
        }
        mimeType = `image/${metadata.format}`;
        width = metadata.width;
        height = metadata.height;
        originalKey = `${prefix}/original`;
        displayKey = `${prefix}/display.webp`;
      }

      const reservation = await this.prisma.$transaction(async (tx) => {
        const current = await tx.media.findUnique({
          where: { id: media.id },
          include: { mediaAsset: true }
        });
        if (
          !current
          || current.status !== "PROCESSING"
          || current.updatedAt.getTime() !== claimTime.getTime()
        ) {
          throw new ConflictException({
            code: "MEDIA_STATE_CHANGED",
            message: "미디어 상태가 변경되어 처리를 완료하지 않았습니다."
          });
        }

        let asset = current.mediaAsset;
        if (!asset) {
          asset = await tx.mediaAsset.create({
            data: {
              familyId: media.album.familyId,
              mimeType,
              width,
              height,
              originalKey,
              displayKey,
              thumbnailKey,
              status: "UPLOADING"
            }
          });
          const reserved = await tx.media.updateMany({
            where: {
              id: media.id,
              status: "PROCESSING",
              updatedAt: claimTime,
              mediaAssetId: null
            },
            data: { mediaAssetId: asset.id, updatedAt: claimTime }
          });
          if (reserved.count === 0) {
            throw new ConflictException({
              code: "MEDIA_STATE_CHANGED",
              message: "미디어 상태가 변경되어 처리를 완료하지 않았습니다."
            });
          }
          return { asset, needsUpload: true };
        }

        if (asset.status === "READY") return { asset, needsUpload: false };
        if (asset.status === "DELETING") {
          const deletionCutoff = new Date(Date.now() - ASSET_DELETION_EXPIRY_MS);
          const recovered = await tx.mediaAsset.updateMany({
            where: { id: asset.id, status: "DELETING", updatedAt: { lt: deletionCutoff } },
            data: { status: "ORPHANED" }
          });
          if (recovered.count === 0) {
            throw new ServiceUnavailableException({
              code: "MEDIA_ASSET_DELETING",
              message: "미디어 에셋을 정리하고 있습니다. 잠시 후 다시 시도해주세요."
            });
          }
          asset = await tx.mediaAsset.findUnique({ where: { id: asset.id } });
          if (!asset) {
            throw new ServiceUnavailableException({
              code: "MEDIA_ASSET_MISSING",
              message: "미디어 에셋을 찾을 수 없습니다. 잠시 후 다시 시도해주세요."
            });
          }
        }
        const prepared = await tx.mediaAsset.updateMany({
          where: { id: asset.id, status: { in: ["ORPHANED", "UPLOADING"] } },
          data: {
            mimeType,
            width,
            height,
            originalKey,
            displayKey,
            thumbnailKey,
            status: "UPLOADING"
          }
        });
        if (prepared.count === 0) {
          throw new ConflictException({
            code: "MEDIA_ASSET_STATE_CHANGED",
            message: "미디어 에셋 상태가 변경되었습니다."
          });
        }
        return { asset: { ...asset, status: "UPLOADING" as const }, needsUpload: true };
      });
      assetIdForRecovery = reservation.asset.id;
      assetNeedsUpload = reservation.needsUpload;
      if (assetNeedsUpload) {
        await Promise.all([
          videoSource
            ? this.storage.copy(media.tempObjectKey, originalKey, mimeType)
            : this.storage.put(originalKey, sourceBytes!, mimeType),
          ...(display ? [this.storage.put(displayKey, display, "image/webp")] : []),
          this.storage.put(thumbnailKey, thumbnail, "image/webp")
        ]);
      }
      const ready = await this.prisma.$transaction(async (tx) => {
        const lockKey = `${media.albumId}:${media.albumDate.toISOString().slice(0, 10)}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        if (assetNeedsUpload) {
          const assetReady = await tx.mediaAsset.updateMany({
            where: { id: reservation.asset.id, status: "UPLOADING" },
            data: { status: "READY" }
          });
          if (assetReady.count === 0) {
            throw new ConflictException({
              code: "MEDIA_ASSET_STATE_CHANGED",
              message: "미디어 에셋 상태가 변경되었습니다."
            });
          }
        } else {
          const currentAsset = await tx.mediaAsset.findUnique({ where: { id: reservation.asset.id } });
          if (!currentAsset) {
            throw new ServiceUnavailableException({
              code: "MEDIA_ASSET_MISSING",
              message: "미디어 에셋을 찾을 수 없습니다. 잠시 후 다시 시도해주세요."
            });
          }
          if (currentAsset.status !== "READY") {
            throw new ConflictException({
              code: "MEDIA_ASSET_STATE_CHANGED",
              message: "미디어 에셋 상태가 변경되었습니다."
            });
          }
        }
        const committed = await tx.media.updateMany({
          where: { id: media.id, status: "PROCESSING", updatedAt: claimTime },
          data: { mediaAssetId: reservation.asset.id, status: "READY", failureReason: null }
        });
        if (committed.count === 0) {
          throw new ConflictException({
            code: "MEDIA_STATE_CHANGED",
            message: "미디어 상태가 변경되어 처리를 완료하지 않았습니다."
          });
        }
        const completed = await tx.media.findUnique({
          where: { id: media.id },
          include: { mediaAsset: true }
        });
        if (!completed) throw new Error("MEDIA_COMMIT_LOST");
        await tx.dailyRepresentative.upsert({
          where: { albumId_albumDate: { albumId: media.albumId, albumDate: media.albumDate } },
          update: {},
          create: { albumId: media.albumId, albumDate: media.albumDate, mediaId: media.id }
        });
        return completed;
      });
      const completed = await this.cleanupTempObject(ready);
      this.logger.log(`media-complete mediaId=${media.id} familyId=${media.album.familyId} mediaAssetId=${reservation.asset.id} uploadSize=${media.uploadSize} mediaType=${videoSource ? "video" : "image"} processingDurationMs=${Date.now() - claimTime.getTime()}`);
      return { mediaId: completed.id, status: completed.status };
    } catch (error) {
      const inputError =
        error instanceof BadRequestException
          ? error
          : error instanceof StorageObjectError
            ? new BadRequestException({
                code: error.code,
                message: error.code === "FILE_TOO_LARGE"
                  ? "사진은 20MB, 영상은 200MB까지 업로드할 수 있습니다."
                  : error.code === "INVALID_CONTENT_TYPE"
                    ? "올바른 MP4 영상 파일이 아닙니다."
                    : "업로드한 파일이 비어 있습니다."
              })
            : null;
      const response = inputError?.getResponse()
        ?? (error instanceof ServiceUnavailableException ? error.getResponse() : null);
      const reason =
        response && typeof response === "object" && "code" in response && typeof response.code === "string"
          ? response.code
          : "MEDIA_PROCESSING_FAILED";
      if (error instanceof ConflictException) throw error;
      try {
        await this.prisma.$transaction(async (tx) => {
          const failed = await tx.media.updateMany({
            where: { id: media.id, status: "PROCESSING", updatedAt: claimTime },
            data: { status: "FAILED", failureReason: reason }
          });
          if (failed.count === 0) {
            throw new ConflictException({
              code: "MEDIA_STATE_CHANGED",
              message: "미디어 상태가 변경되어 실패 상태를 저장하지 않았습니다."
            });
          }
          if (assetNeedsUpload && assetIdForRecovery) {
            await tx.mediaAsset.updateMany({
              where: { id: assetIdForRecovery, status: "UPLOADING" },
              data: { status: "ORPHANED" }
            });
          }
        });
      } catch (persistenceError) {
        if (persistenceError instanceof ConflictException) throw persistenceError;
        throw new ServiceUnavailableException({
          code: "MEDIA_PROCESSING_FAILED",
          message: "파일 처리 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요."
        });
      }
      if (inputError) throw inputError;
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({
        code: "MEDIA_PROCESSING_FAILED",
        message: "파일 처리에 실패했습니다. 잠시 후 다시 시도해주세요."
      });
    }
    } finally {
      await cleanupVideoSource?.();
      releaseMediaProcessingSlot();
    }
  }

  private async cleanupTempObject(
    media: { id: string; tempObjectKey: string | null; status: string },
    failureReason: string | null = null
  ) {
    if (!media.tempObjectKey) return media;
    try {
      await this.storage.delete(media.tempObjectKey);
      return await this.prisma.media.update({
        where: { id: media.id },
        data: { tempObjectKey: null, failureReason },
        include: { album: true, mediaAsset: true }
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      this.logger.warn(`임시 객체 정리 실패: ${media.id} (${cause})`);
      await this.prisma.media.update({
        where: { id: media.id },
        data: { failureReason: failureReason ?? "TEMP_OBJECT_CLEANUP_PENDING" }
      }).catch(() => undefined);
      throw new ServiceUnavailableException({
        code: "MEDIA_CLEANUP_FAILED",
        message: "임시 파일 정리를 완료하지 못했습니다. 잠시 후 다시 시도해주세요."
      });
    }
  }

  private async cleanupMediaAsset(mediaAssetId: string | null | undefined): Promise<void> {
    if (!mediaAssetId) return;
    const candidate = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findUnique({ where: { id: mediaAssetId } });
      if (!asset) return null;
      const deletionCutoff = new Date(Date.now() - ASSET_DELETION_EXPIRY_MS);
      const deletionClaimTime = new Date();
      if (asset.status === "DELETING") {
        if (asset.updatedAt >= deletionCutoff) return null;
        const reclaimed = await tx.mediaAsset.updateMany({
          where: { id: mediaAssetId, status: "DELETING", updatedAt: { lt: deletionCutoff } },
          data: { status: "DELETING", updatedAt: deletionClaimTime }
        });
        if (reclaimed.count === 0) return null;
      } else if (["READY", "ORPHANED", "UPLOADING"].includes(asset.status)) {
        const claimed = await tx.mediaAsset.updateMany({
          where: { id: mediaAssetId, status: asset.status },
          data: { status: "DELETING", updatedAt: deletionClaimTime }
        });
        if (claimed.count === 0) return null;
      } else {
        return null;
      }
      return { ...asset, status: "DELETING" as const, updatedAt: deletionClaimTime };
    });
    if (!candidate) return;

    const deleted = await Promise.allSettled(
      [...new Set([candidate.originalKey, candidate.displayKey, candidate.thumbnailKey])]
        .map((key) => this.storage.delete(key))
    );
    if (deleted.some(({ status }) => status === "rejected")) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset.updateMany({
          where: { id: mediaAssetId, status: "DELETING", updatedAt: candidate.updatedAt },
          data: { status: "ORPHANED" }
        });
      });
      throw new ServiceUnavailableException({
        code: "MEDIA_CLEANUP_FAILED",
        message: "미디어 파일을 완전히 삭제하지 못했습니다. 잠시 후 다시 시도해주세요."
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findUnique({ where: { id: mediaAssetId } });
      if (!asset || asset.status !== "DELETING" || asset.updatedAt.getTime() !== candidate.updatedAt.getTime()) return;
      await tx.media.updateMany({
        where: { mediaAssetId, status: "DELETED" },
        data: { mediaAssetId: null }
      });
      await tx.mediaAsset.delete({ where: { id: mediaAssetId } });
    });
  }

  async list(
    userId: string,
    albumId: string,
    date: string,
    filter: MediaFilter = EMPTY_MEDIA_FILTER
  ) {
    await this.albums.requireAlbum(userId, albumId);
    const albumDate = parseAlbumDate(date);
    const rows = await this.prisma.media.findMany({
      where: {
        albumId,
        albumDate,
        status: "READY",
        ...mediaFilterWhere(filter)
      },
      select: {
        id: true,
        albumDate: true,
        originalName: true,
        uploadedById: true,
        createdAt: true,
        mediaAsset: { select: { width: true, height: true, mimeType: true } },
        childTags: { select: { childTag: true } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30
    });
    return rows.map(({ childTags, ...media }) => ({
      ...media,
      childTags: childTags.map((item) => item.childTag)
    }));
  }

  async feed(
    userId: string,
    albumId: string,
    filter: MediaFilter = EMPTY_MEDIA_FILTER,
    cursor?: string,
    take = 40
  ) {
    await this.albums.requireAlbum(userId, albumId);
    const pageSize = Number.isFinite(take) ? Math.min(Math.max(Math.trunc(take), 1), 60) : 40;
    const rows = await this.prisma.media.findMany({
      where: {
        albumId,
        status: "READY",
        ...mediaFilterWhere(filter)
      },
      select: {
        id: true,
        albumDate: true,
        originalName: true,
        uploadedById: true,
        createdAt: true,
        mediaAsset: { select: { width: true, height: true, mimeType: true } },
        childTags: { select: { childTag: true } }
      },
      orderBy: [{ albumDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const items = rows.slice(0, pageSize).map(({ childTags, ...media }) => ({
      ...media,
      childTags: childTags.map((item) => item.childTag)
    }));
    return {
      items,
      nextCursor: rows.length > pageSize ? items.at(-1)?.id ?? null : null
    };
  }

  async url(userId: string, mediaId: string, variant: "thumbnail" | "display" | "original") {
    if (!["thumbnail", "display", "original"].includes(variant)) {
      throw new BadRequestException({
        code: "INVALID_MEDIA_VARIANT",
        message: "지원하지 않는 미디어 형식입니다."
      });
    }
    const media = await this.prisma.media.findFirst({
      where: {
        id: mediaId,
        status: "READY",
        mediaAsset: { is: { status: "READY" } },
        album: { family: { members: { some: { userId } } } }
      },
      select: {
        originalName: true,
        mediaAsset: {
          select: { originalKey: true, displayKey: true, thumbnailKey: true }
        }
      }
    });
    if (!media?.mediaAsset) {
      throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "미디어를 찾을 수 없습니다." });
    }
    const key = variant === "thumbnail"
      ? media.mediaAsset.thumbnailKey
      : variant === "display"
        ? media.mediaAsset.displayKey
        : media.mediaAsset.originalKey;
    return { url: await this.storage.presignDownload(key, variant === "original" ? media.originalName : undefined) };
  }

  async setRepresentative(userId: string, albumId: string, date: string, mediaId: string) {
    const { membership } = await this.albums.requireAlbum(userId, albumId);
    if (membership.role !== "OWNER") {
      throw new ForbiddenException({ code: "OWNER_REQUIRED", message: "가족 대표만 설정할 수 있습니다." });
    }
    const albumDate = parseAlbumDate(date);
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `${albumId}:${date}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const media = await tx.media.findFirst({
        where: { id: mediaId, albumId, albumDate, status: "READY" }
      });
      if (!media) {
        throw new BadRequestException({
          code: "INVALID_REPRESENTATIVE",
          message: "해당 날짜의 준비된 사진이나 영상만 선택할 수 있습니다."
        });
      }
      return tx.dailyRepresentative.upsert({
        where: { albumId_albumDate: { albumId, albumDate } },
        update: { mediaId },
        create: { albumId, albumDate, mediaId }
      });
    });
  }

  async remove(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "미디어를 찾을 수 없습니다." });
    const { membership } = await this.albums.requireAlbum(userId, media.albumId);
    if (!canDeleteMedia(membership.role, userId, media.uploadedById)) {
      throw new ForbiddenException({ code: "DELETE_FORBIDDEN", message: "본인이 올린 사진이나 영상만 삭제할 수 있습니다." });
    }
    if (media.status === "PROCESSING") {
      throw new ConflictException({
        code: "MEDIA_PROCESSING",
        message: "미디어 처리가 끝난 후 다시 시도해주세요."
      });
    }
    if (media.status !== "DELETED") {
      await this.prisma.$transaction(async (tx) => {
        const lockKey = `${media.albumId}:${media.albumDate.toISOString().slice(0, 10)}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const deleted = await tx.media.updateMany({
          where: {
            id: mediaId,
            status: { in: ["PENDING_UPLOAD", "FAILED", "READY"] }
          },
          data: { status: "DELETED" }
        });
        if (deleted.count === 0) {
          throw new ConflictException({
            code: "MEDIA_STATE_CHANGED",
            message: "미디어 상태가 변경되어 삭제하지 않았습니다."
          });
        }
        const removedRepresentative = await tx.dailyRepresentative.deleteMany({ where: { mediaId } });
        if (removedRepresentative.count > 0) {
          const replacement = await tx.media.findFirst({
            where: { albumId: media.albumId, albumDate: media.albumDate, status: "READY", id: { not: mediaId } },
            orderBy: { createdAt: "desc" }
          });
          if (replacement) {
            await tx.dailyRepresentative.create({
              data: { albumId: media.albumId, albumDate: media.albumDate, mediaId: replacement.id }
            });
          }
        }
      });
    }
    let cleanupPending = false;
    try {
      await this.cleanupTempObject(media);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      cleanupPending = true;
    }
    try {
      await this.cleanupMediaAsset(media.mediaAssetId);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      cleanupPending = true;
    }
    return cleanupPending ? { ok: true, cleanupPending: true } : { ok: true };
  }
}
