'use client'

import { useState } from 'react'
import { CheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'

/**
 * Shared sidebar primitives for consistent UX across metadata sidebars
 * Used by: Post detail sidebar, Changelog sidebar
 */

// ============================================================================
// Layout Primitives
// ============================================================================

interface SidebarContainerProps {
  children: React.ReactNode
  className?: string
}

/**
 * Consistent aside wrapper with animation
 */
export function SidebarContainer({ children, className }: SidebarContainerProps) {
  return (
    <aside
      className={cn(
        'hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5',
        'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards',
        className
      )}
      style={{ animationDelay: '100ms' }}
    >
      <div className="p-4 space-y-5">{children}</div>
    </aside>
  )
}

/**
 * Skeleton loader for sidebar
 */
export function SidebarSkeleton() {
  return (
    <aside className="hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5 p-4 space-y-4">
      <Skeleton className="h-8 w-full rounded" />
      <Skeleton className="h-8 w-full rounded" />
      <Skeleton className="h-24 w-full rounded" />
    </aside>
  )
}

interface SidebarRowProps {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
  /** Use items-start for multi-line content like badges */
  alignTop?: boolean
}

/**
 * Consistent row layout: icon + label on left, control on right
 */
export function SidebarRow({ icon, label, children, alignTop = false }: SidebarRowProps) {
  return (
    <div className={cn('flex justify-between', alignTop ? 'items-start' : 'items-center')}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * Section divider for grouping sidebar content
 */
export function SidebarDivider() {
  return <div className="border-t border-border/30" />
}

/**
 * None label for empty values
 */
export function SidebarNoneLabel() {
  return <span className="text-sm italic text-muted-foreground">None</span>
}

// ============================================================================
// Status Dropdown (Dot + Text Pattern)
// ============================================================================

export interface StatusOption {
  value: string
  label: string
  color: string
}

interface StatusSelectProps {
  value: string
  options: readonly StatusOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Generic status dropdown with colored dot + text pattern.
 * Matches the visual style of StatusDropdown/StatusBadge used in feedback posts.
 */
export function StatusSelect({ value, options, onChange, disabled = false }: StatusSelectProps) {
  const [open, setOpen] = useState(false)
  const currentOption = options.find((o) => o.value === value)

  const handleChange = (newValue: string) => {
    onChange(newValue)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium text-foreground',
            'cursor-pointer hover:opacity-80 transition-opacity',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: currentOption?.color }}
          />
          {currentOption?.label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleChange(option.value)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm',
              'hover:bg-muted/50 transition-colors',
              value === option.value && 'bg-muted/40'
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: option.color }}
            />
            <span className="flex-1 text-left truncate">{option.label}</span>
            {value === option.value && <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ============================================================================
// Badge List with Add Button
// ============================================================================

interface BadgeItem {
  id: string
  label: string
}

interface BadgeListProps<T extends BadgeItem> {
  items: T[]
  onRemove: (id: string) => void
  /** Max items to show before "+N" overflow */
  maxVisible?: number
  /** Badge color variant */
  variant?: 'primary' | 'blue'
  /** Render the add popover trigger and content */
  renderAddPopover?: () => React.ReactNode
}

/**
 * List of removable badges with optional add button.
 * Matches the tag/roadmap badge pattern in MetadataSidebar.
 */
export function BadgeList<T extends BadgeItem>({
  items,
  onRemove,
  maxVisible = 2,
  variant = 'blue',
  renderAddPopover,
}: BadgeListProps<T>) {
  const visibleItems = items.slice(0, maxVisible)
  const overflowCount = items.length - maxVisible

  const badgeClasses =
    variant === 'primary'
      ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 hover:border-primary/30'
      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/15 hover:border-blue-500/30'

  return (
    <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
      {visibleItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onRemove(item.id)}
          className={cn(
            'group inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5',
            'rounded-md text-[11px] font-medium border',
            'transition-all duration-150',
            badgeClasses
          )}
        >
          <span className="truncate max-w-[80px]">{item.label}</span>
          <XMarkIcon className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100 transition-opacity" />
        </button>
      ))}
      {overflowCount > 0 && (
        <span className="text-[11px] text-muted-foreground">+{overflowCount}</span>
      )}
      {renderAddPopover?.()}
      {items.length === 0 && !renderAddPopover && (
        <span className="text-xs text-muted-foreground/60 italic">None</span>
      )}
    </div>
  )
}

/**
 * Standard "Add" button for badge lists
 */
export function AddBadgeButton({
  children: _children,
  ...props
}: React.ComponentProps<typeof PopoverTrigger>) {
  return (
    <PopoverTrigger {...props} asChild>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-0.5 px-1.5 py-0.5',
          'rounded-md text-[11px] font-medium',
          'text-muted-foreground/70 hover:text-muted-foreground',
          'border border-dashed border-border/60 hover:border-border',
          'hover:bg-muted/40',
          'transition-all duration-150'
        )}
      >
        <PlusIcon className="h-2.5 w-2.5" />
        Add
      </button>
    </PopoverTrigger>
  )
}

// ============================================================================
// List Item Primitive
// ============================================================================

interface ListItemProps {
  /** Left slot - typically an avatar, icon, or vote count */
  left?: React.ReactNode
  /** Main title */
  title: string
  /** Meta items shown below title (author, date, category, etc.) */
  meta?: React.ReactNode[]
  /** Action slot - typically a remove button */
  action?: React.ReactNode
  className?: string
}

/**
 * Generic list item with left slot, title, meta, and action.
 * Used for mini post cards, linked items, etc.
 */
export function ListItem({ left, title, meta, action, className }: ListItemProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 p-2 rounded-md',
        'bg-muted/40 border border-border/40 hover:bg-muted/60 transition-colors',
        className
      )}
    >
      {left}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        {meta && meta.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {meta.map((item, i) => (
              <span key={i} className="contents">
                {i > 0 && <span>·</span>}
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
      {action && (
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {action}
        </div>
      )}
    </div>
  )
}

interface VoteCountProps {
  count: number
}

/**
 * Vote count display for list items
 */
export function VoteCount({ count }: VoteCountProps) {
  return (
    <div className="flex flex-col items-center shrink-0 w-8 py-0.5 rounded bg-muted/60">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-3 w-3 text-muted-foreground"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
      </svg>
      <span className="text-[10px] font-semibold tabular-nums">{count}</span>
    </div>
  )
}

/**
 * Remove button for list items
 */
export function ListItemRemoveButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1 rounded hover:bg-muted"
      aria-label={label || 'Remove'}
    >
      <XMarkIcon className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  )
}
