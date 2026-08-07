"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[62vh] items-center py-12 sm:py-20">
      <section className="max-w-xl" aria-labelledby="error-title">
        <div className="mb-7 flex items-center gap-3" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
          <span className="h-px w-20 bg-[var(--border-strong)]" />
        </div>
        <h1
          id="error-title"
          className="text-balance text-3xl font-bold tracking-[-0.035em] text-[var(--text)] sm:text-4xl"
        >
          페이지를 불러오지 못했어요
        </h1>
        <p className="mt-4 max-w-md text-pretty text-base leading-7 text-[var(--muted)]">
          연결이 잠시 불안정합니다. 조금 뒤 다시 불러오면 보던 곳에서 계속할 수 있어요.
        </p>
        <Button type="button" className="mt-8" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          다시 불러오기
        </Button>
      </section>
    </div>
  );
}
