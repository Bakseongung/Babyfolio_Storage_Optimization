"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientApi } from "@/lib/api";
import { currentAlbumMonth } from "@/lib/media-date";

function mergeChildName(names: string[], value: string) {
  const name = value.trim();
  if (!name || names.includes(name)) return names;
  if (name.length > 40) throw new Error("아이 이름은 40자 이내로 입력해주세요.");
  if (names.length >= 10) throw new Error("아이 태그는 최대 10개까지 추가할 수 있어요.");
  return [...names, name];
}

export function NewAlbumForm({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [childInput, setChildInput] = useState("");
  const [childNames, setChildNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function addChildName() {
    try {
      const next = mergeChildName(childNames, childInput);
      if (next === childNames && childInput.trim()) {
        setError("이미 추가한 이름이에요.");
        return;
      }
      setChildNames(next);
      setChildInput("");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이름을 추가하지 못했습니다.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");

    try {
      const names = mergeChildName(childNames, childInput);
      if (!names.length) {
        setError("사진과 영상을 구분할 아이 이름을 한 명 이상 추가해주세요.");
        return;
      }
      setPending(true);
      const album = await clientApi<{ id: string }>(`/families/${familyId}/albums`, {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          childNames: names
        })
      });
      const month = currentAlbumMonth();
      router.push(`/families/${familyId}/albums/${album.id}/calendar?month=${month}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "앨범을 만들지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <Card className="mt-8 overflow-hidden rounded-2xl">
    <form onSubmit={submit}>
      <div className="border-b border-border p-5 sm:p-7">
        <div className="flex gap-4">
          <span
                      className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary"
            aria-hidden="true"
          >
            1
          </span>
          <div className="min-w-0 flex-1">
            <Label
              className="block font-bold"
              htmlFor="newAlbumName"
            >
              앨범 이름
            </Label>
              <p className="muted mt-1 text-[15px]">
              나중에 앨범 목록과 달력 상단에 표시됩니다.
            </p>
            <div className="album-field-row mt-4">
              <Input
                id="newAlbumName"
                name="name"
                placeholder="예: 우리 가족 일상, 2026 여름 여행…"
                autoComplete="off"
                maxLength={60}
                required
              />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex gap-4">
          <span
                      className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary"
            aria-hidden="true"
          >
            2
          </span>
          <div className="min-w-0 flex-1">
            <Label
              className="block font-bold"
              htmlFor="newAlbumChildName"
            >
              사진·영상에서 구분할 아이
            </Label>
              <p className="muted mt-1 text-[15px] leading-6" id="childNameHelp">
              사진이나 영상을 올릴 때 직접 고르는 태그입니다. 이름을 한 명씩
              추가해주세요.
            </p>

            <div className="album-field-row mt-4">
              <Input
                id="newAlbumChildName"
                name="childNameDraft"
                value={childInput}
                placeholder="아이 이름…"
                autoComplete="off"
                maxLength={40}
                aria-describedby="childNameHelp"
                onChange={(event) => {
                  setChildInput(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addChildName();
                  }
                }}
              />
              <Button
                variant="outline"
                type="button"
                onClick={addChildName}
                disabled={!childInput.trim() || pending}
              >
                추가
              </Button>
            </div>

            {childNames.length > 0 && (
              <ul
                className="mt-4 flex flex-wrap gap-2"
                aria-label="추가한 아이 태그"
              >
                {childNames.map((name) => (
                  <li key={name}>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setChildNames((current) =>
                          current.filter((item) => item !== name)
                        );
                        setError("");
                      }}
                      aria-label={`${name} 태그 제거`}
                    >
                      {name}
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mt-5" role="alert" aria-live="polite"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="mt-7 flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            type="button"
            disabled={pending}
            onClick={() => router.push("/families")}
          >
            취소
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "만들고 있어요…" : "앨범 만들기"}
          </Button>
        </div>
      </div>
    </form>
    </Card>
  );
}
