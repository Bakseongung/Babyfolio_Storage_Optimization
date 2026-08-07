"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clientApi } from "@/lib/api";

export function InviteCard({
  token,
  familyName,
  email
}: {
  token: string;
  familyName: string;
  email: string;
}) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function accept() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setError("");
    setPending(true);
    try {
      await clientApi(`/invites/${token}/accept`, { method: "POST" });
      router.push("/families");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "초대를 수락하지 못했습니다.");
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-lg rounded-2xl">
      <CardContent className="p-7 text-center sm:p-10">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-lg font-extrabold text-primary" aria-hidden="true">F</div>
        <p className="eyebrow mb-3 justify-center">가족 앨범 초대</p>
        <h1 className="brand break-words text-balance text-3xl font-extrabold">{familyName}에 초대되었습니다</h1>
        <p className="muted mx-auto mt-4 max-w-sm break-words text-base leading-7">{email} 계정으로 로그인하면 가족 앨범에 참여할 수 있습니다.</p>
        <Button className="mt-7" onClick={accept} disabled={pending}>
          {pending ? "수락 중…" : "초대 수락"}
        </Button>
        <p className="muted mt-5 text-sm"><Button asChild variant="link"><Link href={`/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`}>먼저 로그인하기</Link></Button></p>
        {error ? (
          <Alert variant="destructive" className="mt-4 text-left" role="alert" aria-live="polite">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
