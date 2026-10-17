import { useState } from 'react'
import { useIntl } from 'react-intl'
import { FunnelIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface PortalFilterSheetProps {
  /** Filters the viewer has picked, shown on the trigger. */
  activeCount: number
  /** The filter panel. */
  children: React.ReactNode
  /** Pinned under the Done button, outside the scroll area. */
  footer?: React.ReactNode
}

/**
 * Below the sidebar breakpoint (md), the filter panel opens in a bottom sheet.
 * Filters apply as they are picked; Done just closes the sheet.
 */
export function PortalFilterSheet({
  activeCount,
  children,
  footer,
}: PortalFilterSheetProps): React.ReactElement {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const title = intl.formatMessage({
    id: 'portal.feedback.sheet.filters',
    defaultMessage: 'Filters',
  })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            aria-label={
              activeCount > 0
                ? intl.formatMessage(
                    {
                      id: 'portal.feedback.sheet.filtersOn',
                      defaultMessage: 'Filters, {count} on',
                    },
                    { count: activeCount }
                  )
                : title
            }
          />
        }
      >
        <FunnelIcon className="h-4 w-4" aria-hidden />
        {title}
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground tabular-nums">
            {activeCount}
          </span>
        )}
      </SheetTrigger>
      {/* Header and footer stay put; only the panel scrolls, so Done is
          always in reach. */}
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
        <SheetFooter className="border-t border-border/50">
          <Button className="h-11" onClick={() => setOpen(false)}>
            {intl.formatMessage({ id: 'portal.feedback.sheet.done', defaultMessage: 'Done' })}
          </Button>
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
