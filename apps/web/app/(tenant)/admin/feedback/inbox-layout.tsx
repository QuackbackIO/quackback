'use client'

import { useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
interface InboxLayoutProps {
  filters: React.ReactNode
  postList: React.ReactNode
  postDetail: React.ReactNode
  hasActiveFilters?: boolean
  hasSelectedPost?: boolean
}

export function InboxLayout({
  filters,
  postList,
  postDetail,
  hasActiveFilters,
  hasSelectedPost,
}: InboxLayoutProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  return (
    <div className="flex h-[calc(100vh-65px)]">
      {/* Filters - Desktop */}
      <aside className="hidden lg:flex w-60 xl:w-64 shrink-0 flex-col border-r bg-card">
        <ScrollArea className="flex-1">
          <div className="p-4">{filters}</div>
        </ScrollArea>
      </aside>

      {/* Mobile filter button */}
      <div className="lg:hidden fixed bottom-4 left-4 z-50">
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetTrigger asChild>
            <Button size="lg" className="rounded-full shadow-lg">
              <Filter className="h-5 w-5 mr-2" />
              Filters
              {hasActiveFilters && (
                <span className="ml-2 h-2 w-2 rounded-full bg-primary-foreground" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-60px)]">
              <div className="p-4">{filters}</div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      {/* Post List - narrow column */}
      <main className="w-[300px] lg:w-[360px] shrink-0 flex flex-col border-r">
        <ScrollArea className="flex-1">{postList}</ScrollArea>
      </main>

      {/* Post Detail - Desktop (always visible, takes remaining space) */}
      <aside className="hidden md:flex flex-1 min-w-0 flex-col bg-card">
        <ScrollArea className="flex-1">{postDetail}</ScrollArea>
      </aside>

      {/* Post Detail - Mobile Sheet (only when post selected) */}
      <Sheet open={hasSelectedPost && typeof window !== 'undefined' && window.innerWidth < 768}>
        <SheetContent side="right" className="w-full sm:w-[400px] p-0">
          <ScrollArea className="h-full">{postDetail}</ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}
