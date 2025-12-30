'use client'

import { useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'

interface UsersLayoutProps {
  filters: React.ReactNode
  userList: React.ReactNode
  userDetail: React.ReactNode
  hasActiveFilters?: boolean
}

export function UsersLayout({ filters, userList, userDetail, hasActiveFilters }: UsersLayoutProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  return (
    <div className="flex h-[calc(100vh-69px)] bg-background">
      {/* Filters - Desktop */}
      <aside className="hidden lg:flex w-60 xl:w-64 shrink-0 flex-col border-r border-border/50 bg-card/50 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">{filters}</div>
        </ScrollArea>
      </aside>

      {/* Mobile filter button */}
      <div className="lg:hidden fixed bottom-4 left-4 z-50">
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetTrigger asChild>
            <Button size="lg" className="rounded-full shadow-md">
              <Filter className="h-4 w-4 mr-2" />
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

      {/* User List */}
      <main className="w-[420px] lg:w-[540px] shrink-0 flex flex-col border-r border-border/50 bg-card overflow-hidden">
        <ScrollArea className="h-full">{userList}</ScrollArea>
      </main>

      {/* User Detail */}
      <aside className="hidden md:flex flex-1 min-w-0 flex-col bg-background overflow-hidden">
        <ScrollArea className="h-full">{userDetail}</ScrollArea>
      </aside>
    </div>
  )
}
