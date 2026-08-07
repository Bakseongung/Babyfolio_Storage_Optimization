"use client";

import { RotateCcw } from "lucide-react";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
          <section aria-labelledby="global-error-title">
            <h1 id="global-error-title" className="text-balance text-3xl font-bold">
              앱을 불러오지 못했어요
            </h1>
            <p className="mt-4 text-pretty leading-7 text-neutral-600">
              서버 연결을 확인한 뒤 다시 시도해주세요.
            </p>
            <button
              type="button"
              className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-neutral-900 px-5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={reset}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              다시 시도
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
