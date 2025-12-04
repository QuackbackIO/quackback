import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 active:bg-primary/80',
        destructive:
          'bg-destructive text-white shadow-sm hover:bg-destructive/90 active:bg-destructive/85 focus-visible:ring-destructive/40',
        outline:
          'border border-border/60 bg-transparent hover:bg-muted/50 hover:border-border active:bg-muted/70',
        secondary: 'bg-muted text-foreground hover:bg-muted/70 active:bg-muted/60',
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 active:bg-muted/70',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-lg gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5',
        lg: 'h-11 rounded-lg px-6 has-[>svg]:px-5',
        icon: 'size-9 rounded-lg',
        'icon-sm': 'size-8 rounded-lg',
        'icon-lg': 'size-11 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
