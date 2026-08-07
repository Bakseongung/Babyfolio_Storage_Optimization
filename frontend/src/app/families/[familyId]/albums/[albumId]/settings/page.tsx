import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { AlbumSettings } from "@/components/album-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { currentAlbumMonth } from "@/lib/media-date";
import { protectedApi } from "@/lib/protected-api";
import type { Family, FamilyMember } from "@/lib/types";

export default async function SettingsPage({
  params
}: {
  params: Promise<{ familyId: string; albumId: string }>;
}) {
  const { familyId, albumId } = await params;
  const returnTo = `/families/${familyId}/albums/${albumId}/settings`;
  const families = await protectedApi<Family[]>("/families", returnTo);
  const family = families.find((item) => item.id === familyId);
  const album = family?.albums.find((item) => item.id === albumId);
  if (!family || !album) notFound();

  const isOwner = family.members[0]?.role === "OWNER";
  const members = isOwner
    ? await protectedApi<FamilyMember[]>(`/families/${familyId}/members`, returnTo)
    : [];

  const month = currentAlbumMonth();

  return (
    <section className="mx-auto max-w-2xl">
      <Button asChild variant="link" className="page-back">
        <Link href={`/families/${familyId}/albums/${albumId}/calendar?month=${month}`}>
          <ArrowLeft aria-hidden="true" />
          앨범으로 돌아가기
        </Link>
      </Button>
      <div className="mt-6">
        <p className="eyebrow mb-2">앨범 설정</p>
        <h1 className="brand text-3xl font-extrabold">{album.name}</h1>
        <p className="muted mt-2 text-base">아이 이름 태그와 가족 구성원을 관리하세요.</p>
      </div>
      <Card className="mt-8 rounded-2xl">
        <CardContent className="p-5 sm:p-7">
          <AlbumSettings
            familyId={familyId}
            albumId={albumId}
            childTags={album.childTags}
            members={members}
            isOwner={isOwner}
          />
        </CardContent>
      </Card>
    </section>
  );
}
