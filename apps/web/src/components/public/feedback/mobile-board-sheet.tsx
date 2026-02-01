'use client'

import { useState } from 'react'
import { ListBulletIcon, ChatBubbleLeftIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/shared/utils'
import type { BoardWithStats } from '@/lib/server/domains/boards'

interface MobileBoardSheetProps {
  boards: BoardWithStats[]
  currentBoard?: string
  onBoardChange: (board: string | undefined) => void
}

export function MobileBoardSheet({ boards, currentBoard, onBoardChange }: MobileBoardSheetProps) {
  const [open, setOpen] = useState(false)

  const currentBoardName = currentBoard
    ? boards.find((b) => b.slug === currentBoard)?.name
    : 'All Posts'

  function handleBoardSelect(board: string | undefined): void {
    onBoardChange(board)
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden gap-2">
          <Squares2X2Icon className="h-4 w-4" />
          <span className="max-w-[120px] truncate">{currentBoardName}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0">
        <SheetHeader className="border-b border-border/50 px-4 py-4">
          <SheetTitle className="text-base">Boards</SheetTitle>
        </SheetHeader>
        <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {/* View all posts */}
          <button
            type="button"
            onClick={() => handleBoardSelect(undefined)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer w-full text-left',
              !currentBoard
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <ListBulletIcon className={cn('h-5 w-5 shrink-0', !currentBoard && 'text-primary')} />
            <span>View all posts</span>
          </button>

          {/* Board list */}
          {boards.map((board) => {
            const isActive = currentBoard === board.slug
            return (
              <button
                key={board.id}
                type="button"
                onClick={() => handleBoardSelect(board.slug)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer w-full text-left',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <ChatBubbleLeftIcon
                  className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')}
                />
                <span className="flex-1 truncate">{board.name}</span>
                {board.postCount > 0 && (
                  <span
                    className={cn(
                      'text-xs font-semibold tabular-nums',
                      isActive ? 'text-primary' : 'text-muted-foreground/70'
                    )}
                  >
                    {board.postCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
