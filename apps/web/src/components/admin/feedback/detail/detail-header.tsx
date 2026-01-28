import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  EllipsisHorizontalIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { NavigationContext } from './use-navigation-context'
import type { PostDetails } from '@/components/admin/feedback/inbox-types'

interface DetailHeaderProps {
  post: PostDetails
  navigationContext: NavigationContext
  onEdit: () => void
}

export function DetailHeader({
  post,
  navigationContext,
  onEdit,
}: DetailHeaderProps): React.ReactElement {
  const navigate = useNavigate()

  function navigateToPost(postId: string): void {
    navigate({
      to: '/admin/feedback/posts/$postId',
      params: { postId },
    })
  }

  async function handleCopyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  return (
    <header className="sticky top-0 z-20 bg-gradient-to-b from-card/98 to-card/95 backdrop-blur-md border-b border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between px-6 py-2.5">
        {/* Left side: Back button and breadcrumb */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: navigationContext.backUrl })}
            className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span className="text-sm">Back</span>
          </Button>

          {/* Breadcrumb */}
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <span className="text-muted-foreground/60">Feedback</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground/80 font-medium truncate max-w-[240px]">
              {post.title}
            </span>
          </div>
        </div>

        {/* Right side: Navigation and actions */}
        <div className="flex items-center gap-1.5">
          {/* Position indicator and prev/next (SSR-compatible via URL search params) */}
          {navigationContext.total > 0 && (
            <div className="hidden sm:flex items-center gap-0.5 mr-2 px-2 py-1 rounded-lg bg-muted/30">
              <span className="text-xs tabular-nums text-muted-foreground font-medium px-1">
                {navigationContext.position} / {navigationContext.total}
              </span>
              <div className="flex items-center ml-1 border-l border-border/40 pl-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    navigationContext.prevId && navigateToPost(navigationContext.prevId)
                  }
                  disabled={!navigationContext.prevId}
                  className="h-6 w-6 hover:bg-muted/60 disabled:opacity-30 transition-all duration-150"
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    navigationContext.nextId && navigateToPost(navigationContext.nextId)
                  }
                  disabled={!navigationContext.nextId}
                  className="h-6 w-6 hover:bg-muted/60 disabled:opacity-30 transition-all duration-150"
                >
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="gap-1.5 h-8 border-border/50 hover:border-border hover:bg-muted/50 transition-all duration-150"
          >
            <PencilIcon className="h-3 w-3" />
            <span className="hidden sm:inline text-sm">Edit</span>
          </Button>

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-muted/50 transition-all duration-150"
              >
                <EllipsisHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" sideOffset={4}>
              <DropdownMenuItem
                onClick={() => window.open(`/b/${post.board.slug}/posts/${post.id}`, '_blank')}
                className="gap-2"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                View in Portal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyLink} className="gap-2">
                <LinkIcon className="h-3.5 w-3.5" />
                Copy Link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="gap-2">
                <TrashIcon className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
