import { UploadForm } from "@/components/upload-form";
import { notFound } from "next/navigation";
import { protectedApi } from "@/lib/protected-api";
import type { Album } from "@/lib/types";

export default async function UploadPage({
  params,
  searchParams
}: {
  params: Promise<{ familyId: string; albumId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { familyId, albumId } = await params;
  const defaultDate = (await searchParams).date;
  const returnTo = `/families/${familyId}/albums/${albumId}/upload${
    defaultDate ? `?${new URLSearchParams({ date: defaultDate })}` : ""
  }`;
  const albums = await protectedApi<Album[]>(`/families/${familyId}/albums`, returnTo);
  const album = albums.find((item) => item.id === albumId);
  if (!album) notFound();

  return (
    <UploadForm
      familyId={familyId}
      albumId={albumId}
      defaultDate={defaultDate}
      childTags={album.childTags}
    />
  );
}
