import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/shared/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 shrink-0 rounded-item',
    'text-sm font-medium whitespace-nowrap',
    'cursor-pointer',
    'transition-all duration-200 ease-out',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.98]',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 hover:brightness-94 active:bg-primary/85',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/85 focus-visible:ring-destructive',
        outline:
          'border border-border/50 bg-transparent hover:bg-muted/40 hover:border-border/70 active:bg-muted/60',
        // Danger-zone actions: outlined red, never a filled button.
        'outline-destructive':
          'border border-destructive/40 bg-transparent text-destructive hover:border-destructive/60 hover:bg-destructive/10 active:bg-destructive/15 focus-visible:ring-destructive',
        secondary: 'bg-muted text-foreground hover:bg-muted/80 active:bg-muted/70',
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted/40 active:bg-muted/60',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5',
        lg: 'h-11 px-6 has-[>svg]:px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Style an existing element (usually `Link` or `<a>`) as a button.
     * Merges classes only — does not apply button role, so links stay links.
     */
    asChild?: boolean
  }

function Button({
  className,
  variant,
  size,
  asChild = false,
  render,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }))

  if (asChild) {
    const child = React.Children.toArray(children).find(React.isValidElement)
    return useRender({
      render: (render as React.ReactElement | undefined) ?? child,
      props: { ...props, className: classes, 'data-slot': 'button' },
    })
  }

  return (
    <ButtonPrimitive data-slot="button" className={classes} render={render} {...props}>
      {children}
    </ButtonPrimitive>
  )
}

Button.displayName = 'Button'

export { Button, buttonVariants }
