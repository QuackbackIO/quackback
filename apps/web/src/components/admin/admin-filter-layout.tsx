import { useState } from 'react'
import { FunnelIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Pages inside the layout bring their own 12px edge padding. This adds the rest of the page
 * inset: 16px in total on a phone and 24px once the filter pane is showing.
 */
const PAGE_INSET = 'px-1 lg:px-3'

interface AdminFilterLayoutProps {
  filters: React.ReactNode
  children: React.ReactNode
  hasActiveFilters?: boolean
  /** Whether main content area scrolls internally (default true). Set false for pages that manage their own scrolling. */
  scrollContent?: boolean
  /** Optional title heading at the top of the filter pane, matching the
   *  other admin left panes (no separator). */
  headerTitle?: string
}

export function AdminFilterLayout({
  filters,
  children,
  hasActiveFilters,
  scrollContent = true,
  headerTitle,
}: AdminFilterLayoutProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  return (
    <div className="flex h-full">
      {/* Filters - Desktop */}
      <aside
        data-side-pane=""
        className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-e border-chrome-hairline bg-background overflow-hidden"
      >
        {headerTitle ? (
          <>
            <div className="shrink-0 px-5 py-3.5">
              <PageHeader as="h2" title={headerTitle} />
            </div>
            <ScrollArea
              className="min-h-0 flex-1"
              scrollBarClassName="w-1.5 opacity-0 transition-opacity data-[scrolling]:opacity-100"
            >
              <div className="px-2.5 pb-5">{filters}</div>
            </ScrollArea>
          </>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-2.5">{filters}</div>
          </ScrollArea>
        )}
      </aside>

      {/* Mobile filter button */}
      <div className="lg:hidden fixed bottom-4 left-4 z-50">
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetTrigger asChild>
            <Button size="lg">
              <FunnelIcon className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && (
                <span className="ml-2 h-2 w-2 rounded-full bg-primary-foreground" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b border-border/50">
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-60px)]">
              <div className="p-2.5">{filters}</div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {scrollContent ? (
          <ScrollArea className="h-full">
            <div className={PAGE_INSET}>{children}</div>
          </ScrollArea>
        ) : (
          <div className={cn('flex min-h-0 flex-1 flex-col', PAGE_INSET)}>{children}</div>
        )}
      </div>
    </div>
  )
}
