import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

const buttonVariants = cva(
  // Built on the project's own design tokens (--color-*), not shadcn's default
  // theme names (primary/secondary/muted/ring/input), which are not defined in
  // this Tailwind @theme and would render these buttons uncoloured.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-accent)]/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-[var(--color-danger)]/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-strong)]",
        destructive:
          "bg-[var(--color-danger)] text-white hover:opacity-90 focus-visible:ring-[var(--color-danger)]/30",
        outline:
          "border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        secondary:
          "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
        ghost:
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        link: "text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
