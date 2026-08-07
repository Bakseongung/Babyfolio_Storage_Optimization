"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MonthNavigator({
  baseHref,
  month,
  previous,
  next,
  today,
  filterQuery
}: {
  baseHref: string;
  month: string;
  previous: string;
  next: string;
  today: string;
  filterQuery: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function move(target: string) {
    if (!target || target === month) return;
    const params = new URLSearchParams(filterQuery);
    params.set("month", target);
    startTransition(() => {
      router.push(`${baseHref}?${params}`);
    });
  }

  return (
    <div className="calendar-toolbar" aria-busy={pending}>
      <Button variant="outline" size="icon" type="button" disabled={pending} aria-label="이전 달" onClick={() => move(previous)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div className="calendar-month-control">
        <label>
          <span className="sr-only">이동할 연도와 월</span>
          <input
            className="calendar-month-input brand"
            name="month"
            type="month"
            value={month}
            disabled={pending}
            onChange={(event) => move(event.target.value)}
          />
        </label>
        <Button variant="ghost" size="sm" type="button" disabled={pending || month === today} onClick={() => move(today)}>
          오늘
        </Button>
        <LoaderCircle className="size-4 animate-spin text-muted-foreground data-[hidden=true]:invisible" data-hidden={!pending} aria-hidden="true" />
      </div>
      <Button variant="outline" size="icon" type="button" disabled={pending} aria-label="다음 달" onClick={() => move(next)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
