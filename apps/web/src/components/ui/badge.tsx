import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/shared/utils'

const badgeVariants = cva(
  [
    'inline-flex items-center justify-center gap-1 px-2 py-0.5',
    'rounded-item border font-semibold whitespace-nowrap',
    'w-fit shrink-0 overflow-hidden',
    'transition-all duration-200 ease-out',
    '[&>svg]:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'border-transparent bg-muted/60 text-muted-foreground [a&]:hover:bg-muted',
        destructive:
          'border-transparent bg-destructive/20 text-destructive [a&]:hover:bg-destructive/30',
        outline: 'border-border/50 text-muted-foreground bg-transparent [a&]:hover:bg-muted/50',
        subtle: 'border-transparent bg-muted/40 text-muted-foreground/90 [a&]:hover:bg-muted/60',
        success: 'border-transparent bg-success/15 text-success [a&]:hover:bg-success/25',
        warning: 'border-transparent bg-warning/15 text-warning [a&]:hover:bg-warning/25',
        ghost: 'border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground',
      },
      size: {
        default: 'text-xs [&>svg]:size-3',
        sm: 'text-[11px] [&>svg]:size-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
