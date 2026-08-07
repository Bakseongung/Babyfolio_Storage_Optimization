"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
function DropdownMenuContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return <DropdownMenuPortal><DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn("z-50 min-w-48 overflow-hidden rounded-[10px] border border-border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none", className)} {...props} /></DropdownMenuPortal>;
}
function DropdownMenuItem({ className, inset, variant = "default", ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return <DropdownMenuPrimitive.Item data-inset={inset} data-variant={variant} className={cn("relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground data-[inset=true]:pl-8 data-[variant=destructive]:text-destructive", className)} {...props} />;
}
function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) { return <DropdownMenuPrimitive.Label data-inset={inset} className={cn("px-2.5 py-2 text-xs font-bold text-muted-foreground data-[inset=true]:pl-8", className)} {...props} />; }
function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) { return <DropdownMenuPrimitive.Separator className={cn("-mx-1.5 my-1 h-px bg-border", className)} {...props} />; }

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator };
