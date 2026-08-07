export type MediaFilterState = {
  childTagIds: string[];
  match: "any" | "all";
  untagged: boolean;
};

type FilterSearchParams = {
  tag?: string;
  tags?: string;
  match?: string;
  untagged?: string;
};

export function parseMediaFilter(params: FilterSearchParams): MediaFilterState {
  const legacyTag = params.tag === "untagged" ? undefined : params.tag;
  const childTagIds = [...new Set([
    ...(params.tags?.split(",") ?? []),
    ...(legacyTag ? [legacyTag] : [])
  ].map((id) => id.trim()).filter(Boolean))];
  const untagged = params.untagged === "true" || params.tag === "untagged";

  return {
    childTagIds: untagged ? [] : childTagIds,
    match: params.match === "all" ? "all" : "any",
    untagged
  };
}

export function mediaFilterPageParams(
  filter: MediaFilterState,
  initial?: Record<string, string>
) {
  const params = new URLSearchParams(initial);
  params.delete("tag");
  params.delete("tags");
  params.delete("match");
  params.delete("untagged");

  if (filter.untagged) {
    params.set("untagged", "true");
  } else if (filter.childTagIds.length) {
    params.set("tags", filter.childTagIds.join(","));
    if (filter.childTagIds.length > 1 && filter.match === "all") {
      params.set("match", "all");
    }
  }
  return params;
}

export function mediaFilterApiParams(
  filter: MediaFilterState,
  initial?: Record<string, string>
) {
  const params = new URLSearchParams(initial);
  if (filter.untagged) {
    params.set("untagged", "true");
  } else if (filter.childTagIds.length) {
    params.set("childTagIds", filter.childTagIds.join(","));
    if (filter.childTagIds.length > 1 && filter.match === "all") {
      params.set("match", "all");
    }
  }
  return params;
}

export function mediaFilterKey(filter: MediaFilterState) {
  return filter.untagged
    ? "untagged"
    : `${filter.match}:${filter.childTagIds.join(",") || "all"}`;
}
