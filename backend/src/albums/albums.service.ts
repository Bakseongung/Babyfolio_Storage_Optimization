import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service.js";
import { parseAlbumMonth } from "../common/album-date.js";
import {
  EMPTY_MEDIA_FILTER,
  mediaFilterWhere,
  type MediaFilter
} from "../common/media-filter.js";
import { FamiliesService } from "../families/families.service.js";
import type { CreateAlbumDto } from "./albums.dto.js";

@Injectable()
export class AlbumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly families: FamiliesService
  ) {}

  async list(userId: string, familyId: string) {
    await this.families.requireMembership(userId, familyId);
    return this.prisma.album.findMany({
      where: { familyId },
      include: { childTags: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" }
    });
  }

  async create(userId: string, familyId: string, dto: CreateAlbumDto) {
    await this.families.requireMembership(userId, familyId, "OWNER");
    const childNames = [...new Set(dto.childNames.map((name) => name.trim()))];
    if (childNames.some((name) => !name)) {
      throw new BadRequestException({ code: "INVALID_CHILD_TAG", message: "아이 이름을 입력해주세요." });
    }
    return this.prisma.album.create({
      data: {
        familyId,
        name: dto.name.trim(),
        childTags: { createMany: { data: childNames.map((name) => ({ name })) } }
      },
      include: { childTags: { orderBy: { createdAt: "asc" } } }
    });
  }

  async requireAlbum(userId: string, albumId: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException({ code: "ALBUM_NOT_FOUND", message: "앨범을 찾을 수 없습니다." });
    const membership = await this.families.requireMembership(userId, album.familyId);
    return { album, membership };
  }

  async createChildTag(userId: string, albumId: string, name: string) {
    const { membership } = await this.requireAlbum(userId, albumId);
    if (membership.role !== "OWNER") {
      throw new ForbiddenException({ code: "OWNER_REQUIRED", message: "가족 대표만 할 수 있습니다." });
    }
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new BadRequestException({ code: "INVALID_CHILD_TAG", message: "아이 이름을 입력해주세요." });
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`child-tags:${albumId}`}))`;
      const count = await tx.childTag.count({ where: { albumId } });
      if (count >= 10) {
        throw new ConflictException({
          code: "CHILD_TAG_LIMIT",
          message: "아이 이름은 앨범마다 최대 10개까지 추가할 수 있습니다."
        });
      }
      return tx.childTag.create({ data: { albumId, name: normalizedName } });
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException({ code: "CHILD_TAG_EXISTS", message: "이미 등록된 아이 이름입니다." });
      }
      throw error;
    });
  }

  async deleteChildTag(userId: string, albumId: string, tagId: string): Promise<void> {
    const notFound = { code: "CHILD_TAG_NOT_FOUND", message: "아이 이름 태그를 찾을 수 없습니다." };
    const { membership } = await this.requireAlbum(userId, albumId).catch((error: unknown) => {
      if (error instanceof NotFoundException) throw new NotFoundException(notFound);
      throw error;
    });
    if (membership.role !== "OWNER") {
      throw new ForbiddenException({ code: "OWNER_REQUIRED", message: "가족 대표만 할 수 있습니다." });
    }
    const { count } = await this.prisma.childTag.deleteMany({ where: { id: tagId, albumId } });
    if (!count) throw new NotFoundException(notFound);
  }

  async calendar(
    userId: string,
    albumId: string,
    month: string,
    filter: MediaFilter = EMPTY_MEDIA_FILTER
  ) {
    await this.requireAlbum(userId, albumId);
    const start = parseAlbumMonth(month);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const where = {
      albumId,
      albumDate: { gte: start, lt: end },
      status: "READY" as const,
      ...mediaFilterWhere(filter)
    };
    const filtered = filter.untagged || filter.childTagIds.length > 0;
    const [rows, representatives] = await Promise.all([
      this.prisma.media.groupBy({
        by: ["albumDate"],
        where,
        _count: { _all: true },
        orderBy: { albumDate: "asc" }
      }),
      filtered
        ? this.prisma.media.findMany({
            where,
            select: { id: true, albumDate: true },
            orderBy: [{ albumDate: "asc" }, { createdAt: "desc" }, { id: "desc" }]
          })
        : this.prisma.dailyRepresentative.findMany({
            where: { albumId, albumDate: { gte: start, lt: end } },
            select: { albumDate: true, mediaId: true }
          })
    ]);
    const representativeByDate = new Map<string, string>();
    for (const representative of representatives) {
      const date = representative.albumDate.toISOString().slice(0, 10);
      if (!representativeByDate.has(date)) {
        representativeByDate.set(
          date,
          "mediaId" in representative ? representative.mediaId : representative.id
        );
      }
    }
    return rows.map((row) => {
      const date = row.albumDate.toISOString().slice(0, 10);
      return {
        date,
        count: row._count._all,
        representativeMediaId: representativeByDate.get(date) ?? null
      };
    });
  }
}
