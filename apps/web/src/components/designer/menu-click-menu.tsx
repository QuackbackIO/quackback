import { useEffect, useRef, type ComponentType, type SVGProps } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Cog6ToothIcon,
  EyeSlashIcon,
  HomeIcon,
  LinkIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/16/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { ClickMenu, MenuAction } from '@/lib/shared/design/menu-actions'
import { cn } from '@/lib/shared/utils'

const ICONS: Record<MenuAction, ComponentType<SVGProps<SVGSVGElement>>> = {
  go: ArrowRightIcon,
  rename: PencilIcon,
  land: HomeIcon,
  hide: EyeSlashIcon,
  left: ArrowLeftIcon,
  right: ArrowRightIcon,
  'edit-link': LinkIcon,
  remove: TrashIcon,
  'sign-in-settings': Cog6ToothIcon,
}

/** A key, or a gesture, drawn as one. */
const KEY_HINTS = new Set(['Enter', 'Double-click'])

/** Where a menu opens against: an element, or a box on the screen. */
export type MenuAnchor = Element | { getBoundingClientRect: () => DOMRect } | null

/**
 * A menu item's own menu, opened by a click on it in the page: Go to first,
 * focused so Enter takes it, then the changes it can take. The arrow keys
 * move through it and Escape closes it, back to the page.
 */
export function MenuClickMenu({
  menu,
  anchor,
  boundary,
  onAction,
  onClose,
}: {
  menu: ClickMenu
  anchor: MenuAnchor
  /** What the menu stays inside, such as the canvas. */
  boundary?: Element
  onAction: (action: MenuAction) => void
  onClose: () => void
}) {
  const first = useRef<HTMLDivElement>(null)
  // Opened by a click in the page, not on a trigger: the default is focused by hand.
  useEffect(() => {
    let tries = 0
    let frame = 0
    const focus = () => {
      if (first.current) return first.current.focus()
      if (tries++ < 10) frame = requestAnimationFrame(focus)
    }
    focus()
    return () => cancelAnimationFrame(frame)
  }, [])
  const [lead, ...rest] = menu.entries
  // What the item is: over the changes, or over the one entry there is.
  const title = menu.title && (
    <DropdownMenuLabel className="max-w-72 py-1 text-[11px] font-normal text-muted-foreground">
      {menu.title}
    </DropdownMenuLabel>
  )
  const entry = (each: ClickMenu['entries'][number], ref?: typeof first) => {
    const Icon = ICONS[each.action]
    return (
      <DropdownMenuItem
        key={each.action}
        ref={ref}
        disabled={each.disabled}
        onClick={() => {
          onAction(each.action)
          onClose()
        }}
        className={cn('min-w-60 py-1.5 text-[13px]', ref && 'font-medium')}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className="me-4">{each.label}</span>
        {each.hint && (
          <span
            className={cn(
              'ms-auto text-[11px] text-muted-foreground',
              KEY_HINTS.has(each.hint) && 'rounded border border-border px-1.5 leading-4'
            )}
          >
            {each.hint}
          </span>
        )}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuContent
        anchor={anchor}
        collisionBoundary={boundary}
        align="start"
        sideOffset={8}
        aria-label={lead?.label ?? 'Menu item'}
        data-menu-click-menu=""
      >
        {!rest.length && title}
        {lead && entry(lead, first)}
        {rest.length > 0 && <DropdownMenuSeparator />}
        {rest.length > 0 && title}
        {rest.map((each) => entry(each))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
