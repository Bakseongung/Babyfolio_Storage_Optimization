import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";

export type MediaFilter = {
  childTagIds: string[];
  match: "any" | "all";
  untagged: boolean;
};

export const EMPTY_MEDIA_FILTER: MediaFilter = {
  childTagIds: [],
  match: "any",
  untagged: false
};

export function parseMediaFilter({
  childTagId,
  childTagIds,
  match,
  untagged
}: {
  childTagId?: string;
  childTagIds?: string;
  match?: string;
  untagged?: string;
}): MediaFilter {
  const ids = [...new Set([
    ...(childTagIds?.split(",") ?? []),
    ...(childTagId ? [childTagId] : [])
  ].map((id) => id.trim()).filter(Boolean))];

  if (ids.length > 10 || (match && match !== "any" && match !== "all")) {
    throw new BadRequestException({
      code: "INVALID_MEDIA_FILTER",
      message: "미디어 필터가 올바르지 않습니다."
    });
  }

  const showUntagged = untagged === "true" || ids.includes("untagged");
  return {
    childTagIds: showUntagged ? [] : ids.filter((id) => id !== "untagged"),
    match: match === "all" ? "all" : "any",
    untagged: showUntagged
  };
}

export function mediaFilterWhere(filter: MediaFilter): Prisma.MediaWhereInput {
  if (filter.untagged) return { childTags: { none: {} } };
  if (!filter.childTagIds.length) return {};
  if (filter.match === "all") {
    return {
      AND: filter.childTagIds.map((childTagId) => ({
        childTags: { some: { childTagId } }
      }))
    };
  }
  return {
    childTags: {
      some: { childTagId: { in: filter.childTagIds } }
    }
  };
}
