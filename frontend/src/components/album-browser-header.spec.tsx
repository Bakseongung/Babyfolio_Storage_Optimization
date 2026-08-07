import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlbumBrowserHeader } from "./album-browser-header";

const album = {
  id: "album-1",
  familyId: "family-1",
  name: "우리의 여름",
  childTags: []
};
const filter = { childTagIds: [], match: "any" as const, untagged: false };

describe("album browser permissions", () => {
  it("does not offer owner-only actions to a family member", () => {
    const markup = renderToStaticMarkup(
      <AlbumBrowserHeader
        family={{ id: "family-1", name: "우리 가족", members: [{ role: "MEMBER" }], albums: [album] }}
        album={album}
        month="2026-08"
        filter={filter}
        activeView="calendar"
      />
    );

    expect(markup).not.toContain("새 앨범");
    expect(markup).not.toContain("앨범 설정");
    expect(markup).toContain("사진·영상 올리기");
  });
});
