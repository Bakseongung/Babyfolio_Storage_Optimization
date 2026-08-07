import { redirect } from "next/navigation";
import { FamilyManager } from "@/components/family-manager";
import { currentAlbumMonth } from "@/lib/media-date";
import { protectedApi } from "@/lib/protected-api";
import type { Family } from "@/lib/types";

export default async function FamiliesPage() {
  const families = await protectedApi<Family[]>("/families");

  const familyWithAlbum = families.find((family) => family.albums.length > 0);
  const album = familyWithAlbum?.albums[0];
  if (familyWithAlbum && album) {
    const month = currentAlbumMonth();
    redirect(`/families/${familyWithAlbum.id}/albums/${album.id}/calendar?month=${month}`);
  }

  return <FamilyManager families={families} />;
}
