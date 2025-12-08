'use client'

import Image from 'next/image'
import Link from 'next/link'
import { LayoutList, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { BoardWithStats } from '@quackback/domain'

interface FeedbackSidebarProps {
  boards: BoardWithStats[]
  currentBoard?: string
  onBoardChange: (boardSlug: string | undefined) => void
}

export function FeedbackSidebar({ boards, currentBoard, onBoardChange }: FeedbackSidebarProps) {
  return (
    <aside className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24">
        <div className="bg-card border border-border/50 rounded-lg shadow-sm max-h-[calc(100vh-10rem)] flex flex-col overflow-hidden">
          <h2 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground px-4 pt-4 pb-3 shrink-0">
            Boards
          </h2>
          <ScrollArea className="flex-1 min-h-0 w-full">
            <nav className="space-y-1 px-4 pb-4 w-[calc(16rem-2px)]">
              {/* View all posts */}
              <button
                onClick={() => onBoardChange(undefined)}
                className={cn(
                  'max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors text-left',
                  !currentBoard
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <LayoutList className={cn('h-4 w-4 shrink-0', !currentBoard && 'text-primary')} />
                <span className="truncate">View all posts</span>
              </button>

              {/* Board list */}
              {boards.map((board) => {
                const isActive = currentBoard === board.slug
                return (
                  <button
                    key={board.id}
                    onClick={() => onBoardChange(board.slug)}
                    className={cn(
                      'max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors text-left',
                      isActive
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <MessageSquare className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                    <span className="truncate min-w-0">{board.name}</span>
                    {board.postCount > 0 && (
                      <span
                        className={cn(
                          'text-[10px] font-semibold ml-auto pl-1 shrink-0 tabular-nums',
                          isActive ? 'text-primary' : 'text-muted-foreground/60'
                        )}
                      >
                        {board.postCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
          </ScrollArea>
        </div>

        {/* Powered by */}
        <Link
          href="https://quackback.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-3"
        >
          <span>Powered by</span>
          <Image src="/logo.png" alt="" width={12} height={12} className="opacity-50" />
          <span className="font-medium">Quackback</span>
        </Link>
      </div>
    </aside>
  )
}
