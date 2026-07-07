import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { NAV_SECTION_CLASS } from '@/components/shared/nav-tokens'

const TITLE_CLASS = NAV_SECTION_CLASS

/**
 * The canonical admin left-pane subheading. Collapsible by default; pass
 * `collapsible={false}` for a static label, and `action` to render a control
 * (e.g. a create button) on the right. Used by every admin filter/nav pane so
 * subheadings read identically across the app.
 */
export function FilterSection({
  title,
  children,
  hint,
  defaultOpen = true,
  action,
  collapsible = true,
}: {
  title: string
  children: React.ReactNode
  hint?: string
  defaultOpen?: boolean
  action?: React.ReactNode
  collapsible?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const open = collapsible ? isOpen : true

  return (
    <div className="pb-4 last:pb-0">
      <div className="flex w-full items-center justify-between">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              'flex flex-1 items-center justify-between py-1 transition-colors hover:text-foreground',
              TITLE_CLASS
            )}
          >
            {title}
            {isOpen ? (
              <ChevronUpIcon className="h-3 w-3" />
            ) : (
              <ChevronDownIcon className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className={cn('py-1', TITLE_CLASS)}>{title}</span>
        )}
        {action}
      </div>
      {open && (
        <div className="mt-2">
          {children}
          {hint && <p className="mt-2 text-[10px] text-muted-foreground/60">{hint}</p>}
        </div>
      )}
    </div>
  )
}
