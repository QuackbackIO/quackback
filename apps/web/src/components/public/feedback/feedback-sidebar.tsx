import { Link } from '@tanstack/react-router'
import { ListBulletIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import type { BoardWithStats } from '@/lib/boards'

interface FeedbackSidebarProps {
  boards: BoardWithStats[]
  currentBoard?: string
}

export function FeedbackSidebar({ boards, currentBoard }: FeedbackSidebarProps) {
  return (
    <aside className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24">
        <div className="bg-card border border-border/50 rounded-lg shadow-sm overflow-hidden">
          <h2 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground px-4 pt-4 pb-3">
            Boards
          </h2>
          <nav className="space-y-1 px-4 pb-4 max-h-[calc(100vh-14rem)] overflow-y-auto scrollbar-thin">
            {/* View all posts */}
            <Link
              to="/"
              search={(prev: Record<string, unknown>) => ({ ...prev, board: undefined })}
              className={cn(
                'max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
                !currentBoard
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <ListBulletIcon className={cn('h-4 w-4 shrink-0', !currentBoard && 'text-primary')} />
              <span className="truncate">View all posts</span>
            </Link>

            {/* Board list */}
            {boards.map((board) => {
              const isActive = currentBoard === board.slug
              return (
                <Link
                  key={board.id}
                  to="/"
                  search={(prev: Record<string, unknown>) => ({ ...prev, board: board.slug })}
                  className={cn(
                    'max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <ChatBubbleLeftIcon
                    className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')}
                  />
                  <span className="truncate min-w-0">{board.name}</span>
                  {board.postCount > 0 && (
                    <span
                      className={cn(
                        'text-[10px] font-semibold ml-auto pl-1 shrink-0 tabular-nums',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {board.postCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Powered by */}
        <a
          href="https://quackback.io"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-3"
        >
          <span>Powered by</span>
          <img
            src="/logo.png"
            alt=""
            width={12}
            height={12}
            className="opacity-50 group-hover:opacity-100 transition-opacity"
          />
          <span className="font-medium">Quackback</span>
        </a>
      </div>
    </aside>
  )
}
