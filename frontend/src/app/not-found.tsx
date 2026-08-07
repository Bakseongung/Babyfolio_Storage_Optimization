import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "페이지를 찾을 수 없음 | Family Frame" };

export default function NotFound() {
  return (
    <section className="mx-auto grid min-h-[calc(100dvh-200px)] max-w-4xl items-center gap-10 py-8 md:grid-cols-[1fr_0.8fr] md:py-14">
      <div className="max-w-xl">
        <p className="eyebrow mb-3">찾을 수 없는 페이지</p>
        <h1 className="brand text-balance text-4xl font-extrabold leading-tight sm:text-5xl">
          이 장면은 앨범에 없어요.
        </h1>
        <p className="muted mt-5 max-w-lg text-pretty text-base leading-7 sm:text-lg">
          주소가 바뀌었거나 페이지가 정리된 것 같아요. 앨범으로 돌아가 이어서 미디어를 확인해 보세요.
        </p>
        <Button asChild className="mt-8">
          <Link href="/families">
            <ArrowLeft aria-hidden="true" />
            앨범으로 돌아가기
          </Link>
        </Button>
      </div>

      <div className="relative mx-auto w-full max-w-[290px] pb-5" aria-hidden="true">
        <div className="absolute inset-x-7 top-5 h-[290px] rotate-6 rounded-[22px] border border-border bg-accent-soft shadow-[0_18px_45px_rgb(28_50_40/10%)]" />
        <div className="relative -rotate-3 rounded-[22px] border border-border bg-white p-4 shadow-[0_22px_55px_rgb(28_50_40/14%)]">
          <div className="grid aspect-square place-items-center rounded-[14px] bg-[linear-gradient(145deg,#edf3ef,#dbe8df)] text-primary">
            <div className="text-center">
              <ImageOff className="mx-auto size-9 opacity-65" />
              <span className="brand mt-4 block text-6xl font-extrabold tracking-[-0.08em]">404</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-1 pb-1 pt-4 text-xs font-bold text-muted-foreground">
            <span>Family Frame</span>
            <span>미디어 없음</span>
          </div>
        </div>
      </div>
    </section>
  );
}
