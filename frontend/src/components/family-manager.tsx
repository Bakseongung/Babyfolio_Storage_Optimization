"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientApi } from "@/lib/api";
import { currentAlbumMonth } from "@/lib/media-date";
import type { Family } from "@/lib/types";

export function FamilyManager({ families }: { families: Family[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const month = currentAlbumMonth();

  async function startAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const albumName = String(data.get("albumName") ?? "").trim();
    const childNames = String(data.get("childNames") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    setError("");
    setSubmitting(true);

    try {
      let targetFamilyId = familyId;
      if (!targetFamilyId) {
        const family = await clientApi<{ id: string }>("/families", {
          method: "POST",
          body: JSON.stringify({ name: "우리 가족" })
        });
        targetFamilyId = family.id;
        setFamilyId(family.id);
      }
      const album = await clientApi<{ id: string }>(`/families/${targetFamilyId}/albums`, {
        method: "POST",
        body: JSON.stringify({
          name: albumName,
          childNames
        })
      });
      router.push(`/families/${targetFamilyId}/albums/${album.id}/calendar?month=${month}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "앨범을 시작하지 못했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <section className="onboarding">
      <div className="onboarding-copy">
        <p className="eyebrow mb-3">우리 가족의 첫 장</p>
        <h1 className="brand text-balance text-4xl font-extrabold sm:text-5xl">
          가족의 순간을<br />날짜별로 모아보세요
        </h1>
        <p className="muted mt-5 max-w-md text-base leading-7">
          아이 이름을 여러 명 등록하고, 사진이나 영상을 올릴 때 나온 아이를 직접 선택할 수 있어요.
          사진과 영상은 초대한 가족과만 볼 수 있습니다.
        </p>
      </div>

      <Card className="rounded-2xl">
      <form className="onboarding-form" onSubmit={startAlbum}>
        <div>
          <h2 className="text-xl font-bold">첫 앨범 만들기</h2>
          <p className="muted mt-2 text-base">나중에 앨범 설정에서 가족을 초대할 수 있어요.</p>
        </div>
        <Label className="mt-7 block" htmlFor="albumName">
          앨범 이름
        </Label>
        <Input
          className="mt-2"
          id="albumName"
          name="albumName"
          placeholder="예: 우리 가족의 성장 기록…"
          autoComplete="off"
          required
        />
        <Label className="mt-5 block" htmlFor="childNames">
          아이 이름 태그
        </Label>
            <p className="muted mt-1 text-sm">여러 명이면 쉼표로 구분해주세요.</p>
        <Input
          className="mt-2"
          id="childNames"
          name="childNames"
          placeholder="예: 민서, 준서…"
          autoComplete="off"
          required
        />
        {error && (
          <Alert variant="destructive" className="mt-4" role="alert" aria-live="polite"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        <Button className="mt-7 w-full" type="submit" disabled={submitting}>
          {submitting ? "앨범을 만들고 있어요…" : "앨범 시작하기"}
        </Button>
      </form>
      </Card>
    </section>
  );
}
