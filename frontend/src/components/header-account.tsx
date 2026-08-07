"use client";

import { useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { clientApi } from "@/lib/api";
import { replaceDocument } from "@/lib/document-navigation";

export async function logoutAndRedirect(): Promise<void> {
  await clientApi("/auth/logout", { method: "POST" });
  replaceDocument("/login");
}

export function HeaderAccount({ displayName }: { displayName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setPending(true);
    setError("");
    try {
      await logoutAndRedirect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그아웃하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="max-w-52 gap-2 px-2.5" aria-label="계정 메뉴 열기">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <UserRound className="size-4" aria-hidden="true" />
            </span>
            <span className="hidden truncate sm:block">{displayName}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="max-w-56 truncate">{displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault();
              void logout();
            }}
          >
            <LogOut aria-hidden="true" />
            {pending ? "로그아웃 중…" : "로그아웃"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span className="text-xs font-medium text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
