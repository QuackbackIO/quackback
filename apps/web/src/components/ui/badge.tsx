import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/shared/utils'

const badgeVariants = cva(
  [
    'inline-flex items-center justify-center gap-1 px-2 py-0.5',
    'border [border-radius:calc(var(--radius)*0.6)]',
    'text-xs font-medium whitespace-nowrap',
    'w-fit shrink-0 overflow-hidden',
    'transition-all duration-200 ease-out',
    '[&>svg]:size-3 [&>svg]:pointer-events-none',
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
        ghost: 'border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
