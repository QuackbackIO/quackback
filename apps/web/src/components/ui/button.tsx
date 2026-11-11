import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { IntlContext } from 'react-intl'

import { cn } from '@/lib/shared/utils'

// Every button's shared look is one rule, .qb-button in globals.css, rather
// than some thirty classes each button carries in every page's HTML. It sits
// in the components layer, so any utility a variant, size or caller adds wins.
const buttonVariants = cva('qb-button', {
  variants: {
    variant: {
      // Disabled in dark mode, a muted fill (globals.css, one rule rather than classes on every button).
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
      sm: 'h-8 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 gap-1.5 px-3 text-ui has-[>svg]:px-2.5',
      // Compact builder sizes. Same padding and gap as sm, so swapping an h-7 or h-6 override changes nothing.
      xs: 'h-7 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 gap-1.5 px-2 text-xs has-[>svg]:px-2.5',
      '2xs':
        'h-6 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 gap-1.5 px-2 text-xs has-[>svg]:px-2.5',
      lg: 'h-11 px-6 has-[>svg]:px-5',
      icon: 'size-9',
      'icon-sm':
        'size-8 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5',
      'icon-xs':
        'size-6 relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5',
      'icon-lg': 'size-11',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

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
      props: {
        ...props,
        className: classes,
        'data-slot': 'button',
        'data-variant': variant ?? 'default',
      },
    })
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? 'default'}
      className={classes}
      render={render}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  )
}

Button.displayName = 'Button'

const NEW_TAB_MESSAGE = { id: 'common.opensInNewTab', defaultMessage: '(opens in a new tab)' }

/**
 * Visually hidden text for a link that opens in a new tab, so screen readers
 * say so. Put it inside the link, after its label. It reads the intl context
 * directly so a link rendered outside a provider still gets the English text.
 *
 * It lives beside Button because every page already loads this module: as a
 * module of its own, the shell and the lazy settings pages would share it
 * through a chunk of its own, one more request on every admin page.
 */
function NewTabHint() {
  const intl = React.useContext(IntlContext)
  return (
    <span className="sr-only">
      {' '}
      {intl ? intl.formatMessage(NEW_TAB_MESSAGE) : NEW_TAB_MESSAGE.defaultMessage}
    </span>
  )
}

export { Button, buttonVariants, NewTabHint }
