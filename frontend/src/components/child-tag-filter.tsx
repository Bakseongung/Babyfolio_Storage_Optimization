import Link from "next/link";
import { Baby, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  mediaFilterPageParams,
  type MediaFilterState
} from "@/lib/media-filter";
import type { ChildTag } from "@/lib/types";
import { LinkPendingIndicator } from "./link-pending-indicator";

export function ChildTagFilter({
  baseHref,
  childTags,
  filter,
  searchParams
}: {
  baseHref: string;
  childTags: ChildTag[];
  filter: MediaFilterState;
  searchParams?: Record<string, string>;
}) {
  if (!childTags.length) return null;

  function href(nextFilter: MediaFilterState) {
    const params = mediaFilterPageParams(nextFilter, searchParams);
    const query = params.toString();
    return `${baseHref}${query ? `?${query}` : ""}`;
  }

  const allSelected = !filter.untagged && filter.childTagIds.length === 0;
  const filtered = !allSelected;

  return (
    <nav className="child-filter" aria-label="아이 이름으로 사진과 영상 필터">
      <div className="child-filter-main">
        <span className="child-filter-label" title="아이 필터">
          <Baby aria-hidden="true" />
          <span className="sr-only">아이 필터</span>
        </span>
        <div className="child-filter-tags">
          <Button asChild variant="ghost" size="sm" className="filter-tag" data-selected={allSelected}>
            <Link
              href={href({ childTagIds: [], match: "any", untagged: false })}
              aria-label={`전체 기록${allSelected ? ", 선택됨" : ""}`}
            >
              {allSelected ? <Check aria-hidden="true" /> : null}
              전체
              <LinkPendingIndicator />
            </Link>
          </Button>
          {childTags.map((tag) => {
            const selected = filter.childTagIds.includes(tag.id);
            const childTagIds = selected
              ? filter.childTagIds.filter((id) => id !== tag.id)
              : [...filter.childTagIds, tag.id];

            return (
              <Button key={tag.id} asChild variant="ghost" size="sm" className="filter-tag" data-selected={selected}>
                <Link
                  href={href({
                    childTagIds,
                    match: childTagIds.length > 1 ? filter.match : "any",
                    untagged: false
                  })}
                  aria-label={`${tag.name} 기록${selected ? ", 선택됨" : ""}`}
                >
                  {selected ? <Check aria-hidden="true" /> : null}
                  <span className="truncate">{tag.name}</span>
                  <LinkPendingIndicator />
                </Link>
              </Button>
            );
          })}
          <span className="filter-tag-divider" aria-hidden="true" />
          <Button asChild variant="ghost" size="sm" className="filter-tag" data-selected={filter.untagged}>
            <Link
              href={href({ childTagIds: [], match: "any", untagged: true })}
              aria-label={`태그 없는 기록${filter.untagged ? ", 선택됨" : ""}`}
            >
              {filter.untagged ? <Check aria-hidden="true" /> : null}
              태그 없음
              <LinkPendingIndicator />
            </Link>
          </Button>
        </div>
        {filter.childTagIds.length > 1 ? (
          <div className="child-filter-condition" aria-label="여러 아이 선택 조건">
            <span className="child-filter-condition-label">조건</span>
            <div className="child-filter-condition-options">
              <Link
                className="filter-condition-control"
                data-selected={filter.match === "any"}
                href={href({ ...filter, match: "any" })}
                aria-label="선택한 아이가 한 명 이상 나온 기록"
              >
                한 명 이상
                <LinkPendingIndicator />
              </Link>
              <Link
                className="filter-condition-control"
                data-selected={filter.match === "all"}
                href={href({ ...filter, match: "all" })}
                aria-label="선택한 아이가 모두 함께 나온 기록"
              >
                모두 포함
                <LinkPendingIndicator />
              </Link>
            </div>
          </div>
        ) : null}
        {filtered ? (
          <Button asChild variant="link" size="sm" className="child-filter-reset">
            <Link href={href({ childTagIds: [], match: "any", untagged: false })}>
              초기화
              <LinkPendingIndicator />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
