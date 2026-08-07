"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientApi } from "@/lib/api";
import { replaceDocument } from "@/lib/document-navigation";
import { safeReturnTo } from "@/lib/return-to";

type AuthCredentials = {
  email: FormDataEntryValue | null;
  password: FormDataEntryValue | null;
  displayName?: FormDataEntryValue | null;
};

export async function authenticateAndRedirect(
  mode: "login" | "signup",
  credentials: AuthCredentials,
  returnTo?: string
): Promise<void> {
  await clientApi(`/auth/${mode}`, { method: "POST", body: JSON.stringify(credentials) });
  replaceDocument(safeReturnTo(returnTo));
}

export function AuthForm({ mode, returnTo }: { mode: "login" | "signup"; returnTo?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const destination = safeReturnTo(returnTo);
  const alternatePath = mode === "login" ? "/signup" : "/login";
  const alternateHref = destination === "/families"
    ? alternatePath
    : `${alternatePath}?returnTo=${encodeURIComponent(destination)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await authenticateAndRedirect(mode, {
        email: form.get("email"),
        password: form.get("password"),
        ...(mode === "signup" ? { displayName: form.get("displayName") } : {})
      }, destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "오류가 발생했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-shell mx-auto max-w-4xl">
      <div className="auth-visual" aria-hidden="true">
        <div className="relative z-10 flex items-center gap-2 text-sm font-semibold text-white/75">
          <span className="h-px w-6 bg-white/60" />
          우리만 보는 성장 기록
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-pretty text-3xl font-bold leading-tight tracking-[-0.035em]">
            매일의 작은 장면을
            <br />
            오래 간직하세요.
          </p>
          <p className="mt-5 max-w-sm text-base leading-7 text-white/65">
            사진과 영상은 날짜별로 차곡차곡 정리되고, 초대한 가족에게만 열립니다.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-xs text-white/50">
          <span>하루별로 차곡차곡</span>
          <span>·</span>
          <span>가족에게만 공유</span>
        </div>
      </div>

      <div className="flex items-center px-6 py-10 sm:px-10 lg:px-12">
        <div className="mx-auto w-full max-w-sm">
          <p className="eyebrow mb-3">{mode === "login" ? "로그인" : "회원가입"}</p>
          <h1 className="brand text-balance text-3xl font-extrabold sm:text-4xl">
            {mode === "login" ? "Family Frame에 로그인" : "가족 앨범 시작하기"}
          </h1>
          <p className="muted mt-3 mb-8 text-base leading-7">
            {mode === "login" ? "가족과 공유한 기록을 이어서 확인하세요." : "계정을 만든 후 첫 번째 가족 앨범을 설정할 수 있어요."}
          </p>
          <form onSubmit={submit} className="space-y-5">
            {mode === "signup" && (
              <div className="grid gap-2">
                <Label htmlFor="displayName">이름</Label>
                <Input id="displayName" name="displayName" placeholder="예: 김민서…" autoComplete="name" required maxLength={40} />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="email">이메일</Label>
              <Input id="email" name="email" type="email" placeholder="name@example.com…" autoComplete="email" spellCheck={false} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input id="password" name="password" type="password" placeholder="8자 이상 입력…" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
            </div>
            {error && <Alert variant="destructive" role="alert" aria-live="polite"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button className="w-full" disabled={pending}>
              {pending ? "처리 중…" : mode === "login" ? "로그인" : "계정 만들기"}
            </Button>
          </form>
          <p className="muted mt-7 text-center text-[15px]">
            {mode === "login" ? "아직 계정이 없나요? " : "이미 계정이 있나요? "}
            <Link className="inline-flex min-h-11 items-center px-1 font-bold text-[var(--accent)] underline-offset-4 hover:underline" href={alternateHref}>
              {mode === "login" ? "가입하기" : "로그인"}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
