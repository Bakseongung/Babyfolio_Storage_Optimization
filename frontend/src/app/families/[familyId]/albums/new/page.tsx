import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { NewAlbumForm } from "@/components/new-album-form";
import { Button } from "@/components/ui/button";
import { protectedApi } from "@/lib/protected-api";
import type { Family } from "@/lib/types";

export default async function NewAlbumPage({
  params
}: {
  params: Promise<{ familyId: string }>;
}) {
  const { familyId } = await params;
  const returnTo = `/families/${familyId}/albums/new`;
  const families = await protectedApi<Family[]>("/families", returnTo);
  const family = families.find((item) => item.id === familyId);
  if (!family || family.members[0]?.role !== "OWNER") notFound();

  return (
    <section className="mx-auto max-w-2xl">
      <Button asChild variant="link" className="page-back">
        <Link href="/families">
          <ArrowLeft aria-hidden="true" />
          앨범 목록
        </Link>
      </Button>
      <div className="mt-5 max-w-xl">
        <p className="eyebrow mb-2">새 앨범</p>
        <h1 className="brand text-3xl font-extrabold sm:text-4xl">
          어떤 사진과 영상을 모아볼까요?
        </h1>
        <p className="muted mt-3 text-sm leading-6">
          주제나 기간에 맞는 이름을 붙이고, 기록을 찾기 쉽게 아이 태그를
          등록하세요.
        </p>
      </div>
      <NewAlbumForm familyId={familyId} />
    </section>
  );
}
