"use client";

import { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";

export function LinkPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span className="link-pending-indicator" data-pending={pending} aria-live="polite">
      {pending ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          <span className="sr-only">이동 중</span>
        </>
      ) : null}
    </span>
  );
}
