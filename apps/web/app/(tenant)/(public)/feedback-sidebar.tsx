'use client'

import Image from 'next/image'
import Link from 'next/link'
import { LayoutList, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoardWithStats } from '@quackback/db/queries/public'

interface FeedbackSidebarProps {
  boards: BoardWithStats[]
  currentBoard?: string
  onBoardChange: (boardSlug: string | undefined) => void
}

export function FeedbackSidebar({ boards, currentBoard, onBoardChange }: FeedbackSidebarProps) {
  return (
    <aside className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24">
        <div className="bg-card border border-border/50 rounded-lg p-4 shadow-sm">
          <h2 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Boards
          </h2>
          <nav className="space-y-1">
            {/* View all posts */}
            <button
              onClick={() => onBoardChange(undefined)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors text-left',
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
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors text-left',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <MessageSquare className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                  <span className="truncate flex-1">{board.name}</span>
                  {board.postCount > 0 && (
                    <span
                      className={cn(
                        'text-[10px] font-semibold min-w-5 text-center tabular-nums',
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
