import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AlbumSettings } from "./album-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

describe("album child tag settings", () => {
  it("offers an accessible remove action for each tag", () => {
    const markup = renderToStaticMarkup(
      <AlbumSettings
        familyId="family-1"
        albumId="album-1"
        childTags={[{ id: "tag-1", albumId: "album-1", name: "민서" }]}
        members={[]}
        isOwner
      />
    );

    expect(markup).toContain('aria-label="민서 이름표 삭제"');
  });

  it("shows a useful empty state without hiding the add form", () => {
    const markup = renderToStaticMarkup(
      <AlbumSettings
        familyId="family-1"
        albumId="album-1"
        childTags={[]}
        members={[]}
        isOwner
      />
    );

    expect(markup).toContain("아직 추가한 아이 이름이 없어요.");
    expect(markup).toContain("아이 추가");
  });

  it("disables the add form when the album has ten child tags", () => {
    const markup = renderToStaticMarkup(
      <AlbumSettings
        familyId="family-1"
        albumId="album-1"
        childTags={Array.from({ length: 10 }, (_, index) => ({
          id: `tag-${index}`,
          albumId: "album-1",
          name: `아이 ${index + 1}`
        }))}
        members={[]}
        isOwner
      />
    );

    expect(markup).toContain("아이 이름은 최대 10개까지 추가할 수 있어요.");
    expect(markup).toContain('aria-label="추가할 아이 이름" autoComplete="off" required="" disabled=""');
  });

  it("shows joined family members and only offers removal for non-owners", () => {
    const markup = renderToStaticMarkup(
      <AlbumSettings
        familyId="family-1"
        albumId="album-1"
        childTags={[]}
        members={[
          {
            id: "member-owner",
            role: "OWNER",
            createdAt: "2026-08-01T00:00:00.000Z",
            user: { id: "owner-1", displayName: "김대표", email: "owner@example.com" }
          },
          {
            id: "member-guest",
            role: "MEMBER",
            createdAt: "2026-08-02T00:00:00.000Z",
            user: { id: "guest-1", displayName: "이초대", email: "guest@example.com" }
          }
        ]}
        isOwner
      />
    );

    expect(markup).toContain("가족 구성원");
    expect(markup).toContain("김대표");
    expect(markup).toContain("이초대");
    expect(markup).toContain('aria-label="이초대 가족에서 내보내기"');
    expect(markup).not.toContain('aria-label="김대표 가족에서 내보내기"');
  });
});
