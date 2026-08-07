import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-bold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "border border-destructive bg-destructive text-white hover:bg-destructive/90",
        outline: "border border-border bg-card text-foreground hover:border-input hover:bg-secondary",
        secondary: "border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/75",
        ghost: "border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
        link: "min-h-0 rounded-none px-0 text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-11",
        sm: "min-h-10 rounded-lg px-3 text-sm",
        lg: "min-h-12 px-6",
        icon: "size-11 px-0"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
