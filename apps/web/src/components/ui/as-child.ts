import * as React from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

const TRIGGER_TYPE_NAMES = new Set([
  'AlertDialogTrigger',
  'CollapsibleTrigger',
  'ContextMenuSubTrigger',
  'ContextMenuTrigger',
  'DialogTrigger',
  'DropdownMenuSubTrigger',
  'DropdownMenuTrigger',
  'PopoverTrigger',
  'SheetTrigger',
  'TooltipTrigger',
])

/**
 * Overlay composition only (Popover/Menu/Dialog/Tooltip/Sheet triggers).
 * Goal: put the overlay's open/close behavior on an existing control
 * instead of wrapping it in another button.
 *
 * Not for links. `<Button asChild><Link>` is handled in `button.tsx` with
 * `useRender` so the child stays a real link (no `role="button"`).
 *
 * Call sites keep `asChild`; new code should pass `render` directly.
 */
export function asChildRender(
  asChild: boolean | undefined,
  children: React.ReactNode,
  render?: unknown
): {
  render?: React.ReactElement
  children: React.ReactNode
  nativeButton?: boolean
} {
  if (React.isValidElement(render)) {
    const flattened = flattenButtonHost(render)
    return { render: flattened, children, nativeButton: isButtonLikeElement(flattened) }
  }
  if (!asChild) return { children }

  const child = React.Children.toArray(children).find(React.isValidElement)
  if (!child) return { children }

  const flattened = flattenButtonHost(child)
  return {
    render: flattened,
    children: isButtonComponent(child)
      ? (child.props as { children?: React.ReactNode }).children
      : undefined,
    nativeButton: isButtonLikeElement(flattened),
  }
}

/**
 * Props to spread onto a Base UI trigger after `{...props}` so a parent
 * trigger cannot leak `nativeButton={false}` onto a real `<button>`.
 * Tooltip.Trigger does not accept `nativeButton` — omit it there.
 */
export function overlayTriggerProps(
  composed: ReturnType<typeof asChildRender>,
  options: { nativeButton?: boolean } = { nativeButton: true }
) {
  if (!composed.render) return {}
  return options.nativeButton
    ? { render: composed.render, nativeButton: composed.nativeButton }
    : { render: composed.render }
}

function componentName(element: React.ReactElement): string {
  if (typeof element.type === 'string') return element.type
  const type = element.type as { displayName?: string; name?: string }
  return type.displayName ?? type.name ?? ''
}

function isButtonComponent(element: React.ReactElement): boolean {
  const name = componentName(element)
  return name === 'Button' || name === 'IconButton'
}

/**
 * Base UI triggers attach refs and click handlers by cloning `render`.
 * Cloning our `<Button>` (another Base UI button) leaves those refs on the
 * component, not the DOM node — so the overlay never opens. Flatten to a
 * native button that keeps the same styles.
 */
function flattenButtonHost(element: React.ReactElement): React.ReactElement {
  if (!isButtonComponent(element)) return element
  const {
    variant,
    size,
    shape,
    className,
    children: _children,
    asChild: _asChild,
    render: _render,
    ...rest
  } = element.props as {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
    shape?: 'default' | 'pill'
    className?: string
    children?: React.ReactNode
    asChild?: boolean
    render?: unknown
  }
  return React.createElement('button', {
    type: 'button',
    'data-slot': 'button',
    className: cn(buttonVariants({ variant, size, shape, className })),
    ...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>),
  })
}

function isButtonLikeElement(element: React.ReactElement): boolean {
  if (element.type === 'button') return true
  if (typeof element.type === 'string') return false
  const name = componentName(element)
  if (isButtonComponent(element)) return true
  if (TRIGGER_TYPE_NAMES.has(name) || name.endsWith('Trigger')) {
    const nested = React.Children.toArray(
      (element.props as { children?: React.ReactNode }).children
    ).find(React.isValidElement)
    return nested ? isButtonLikeElement(nested) : false
  }
  return false
}
