import { useState } from 'react'
import { FunnelIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'

interface SuggestionsLayoutProps {
  filters: React.ReactNode
  list: React.ReactNode
  detail: React.ReactNode
  hasActiveFilters?: boolean
}

export function SuggestionsLayout({
  filters,
  list,
  detail,
  hasActiveFilters,
}: SuggestionsLayoutProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  return (
    <div className="flex h-full">
      {/* Filter sidebar - Desktop */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">{filters}</div>
        </ScrollArea>
      </aside>

      {/* Mobile filter button */}
      <div className="lg:hidden fixed bottom-4 left-4 z-50">
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetTrigger asChild>
            <Button size="lg" className="rounded-full shadow-md">
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
              <div className="p-4">{filters}</div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      {/* Suggestion list - Center */}
      <div className="w-[400px] lg:w-[480px] shrink-0 border-r border-border/40 flex flex-col bg-card/50 overflow-hidden">
        {list}
      </div>

      {/* Detail panel - Right */}
      <main className="flex-1 min-w-0 bg-card overflow-hidden">{detail}</main>
    </div>
  )
}
