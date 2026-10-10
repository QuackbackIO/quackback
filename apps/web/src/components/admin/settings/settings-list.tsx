import type { ComponentType, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'

/** Divided rows. Rows carry their own horizontal padding, so put the list in `SettingsCard flush`. */
export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="settings-list" className={cn('divide-y divide-border/50', className)}>
      {children}
    </div>
  )
}

/** A 32px muted tile holding a row's icon. */
export function RowIcon({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) {
  return (
    <div
      data-slot="row-icon"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
    >
      <Icon className="size-4" />
    </div>
  )
}

/** A 10px colour dot for rows identified by a colour (statuses, tags). */
export function RowDot({ color }: { color: string }) {
  return (
    <span
      data-slot="row-dot"
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

interface RowActionItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  /** Why the item is unavailable, shown under a disabled item's label. */
  hint?: string
}

/**
 * The row's overflow menu. On hover-capable devices the trigger shows on row
 * hover or focus within (the row is a `group`); on touch it is always visible.
 */
export function RowActions({ label, items }: { label?: string; items: RowActionItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label ? `Actions for ${label}` : 'Actions'}
            className="size-7 text-muted-foreground [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100"
          />
        }
      >
        <EllipsisHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.destructive ? 'destructive' : 'default'}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {item.hint ? (
              <span className="flex flex-col">
                {item.label}
                <span className="text-xs font-normal text-muted-foreground">{item.hint}</span>
              </span>
            ) : (
              item.label
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SettingsListRowProps {
  leading?: ReactNode
  grip?: ReactNode
  title: ReactNode
  /** The muted second line. A row with meta is 52px, without it 44px. */
  meta?: ReactNode
  /** Only for non-default state (StateBadge). */
  badges?: ReactNode
  trailing?: ReactNode
  actions?: RowActionItem[]
  /** Accessible name for the actions menu when `title` is not a string. */
  actionsLabel?: string
  /** Makes the whole row a link with a trailing chevron (and no menu). */
  to?: string
  params?: Record<string, string>
  onClick?: () => void
}

const ROW_BASE = 'group flex items-center gap-3 px-4 sm:px-6 py-2'

export function SettingsListRow({
  leading,
  grip,
  title,
  meta,
  badges,
  trailing,
  actions,
  actionsLabel,
  to,
  params,
  onClick,
}: SettingsListRowProps) {
  const height = meta ? 'min-h-[52px]' : 'min-h-[44px]'
  // Controls inside a clickable row (a switch, a drag handle) act on their own.
  const own = (node: ReactNode) =>
    onClick && node ? (
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        {node}
      </div>
    ) : (
      node
    )
  const body = (
    <>
      {own(grip)}
      {own(leading)}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {badges}
        </div>
        {meta && <div className="mt-px truncate text-[13px] text-muted-foreground">{meta}</div>}
      </div>
      {trailing && (
        <div
          onClick={onClick ? (e) => e.stopPropagation() : undefined}
          className="flex shrink-0 items-center gap-2.5 text-[13px] text-muted-foreground tabular-nums"
        >
          {trailing}
        </div>
      )}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        params={params}
        data-slot="settings-list-row"
        className={cn(ROW_BASE, height, 'transition-colors hover:bg-muted/40')}
      >
        {body}
        <ChevronRightIcon
          data-slot="settings-list-chevron"
          className="size-4 shrink-0 text-muted-foreground/70"
        />
      </Link>
    )
  }

  const menuLabel = actionsLabel ?? (typeof title === 'string' ? title : undefined)
  return (
    <div
      data-slot="settings-list-row"
      className={cn(ROW_BASE, height, onClick && 'cursor-pointer hover:bg-muted/40')}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {body}
      {actions && actions.length > 0 && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <RowActions label={menuLabel} items={actions} />
        </div>
      )}
    </div>
  )
}
