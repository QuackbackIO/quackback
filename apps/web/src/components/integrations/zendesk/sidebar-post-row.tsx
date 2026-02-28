import { Button } from '@/components/ui/button'
import { ArrowUpIcon, LinkIcon, UnlinkIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'

export interface PostRowData {
  id: string
  title: string
  voteCount: number
  statusName?: string | null
  statusColor?: string | null
  similarity?: number | null
  board: { name: string }
}

interface SidebarPostRowProps {
  post: PostRowData
  linked: boolean
  onLink?: () => Promise<void>
  onUnlink?: () => Promise<void>
}

export function SidebarPostRow({ post, linked, onLink, onUnlink }: SidebarPostRowProps) {
  const [loading, setLoading] = useState(false)

  async function handleAction() {
    setLoading(true)
    try {
      if (linked && onUnlink) {
        await onUnlink()
      } else if (!linked && onLink) {
        await onLink()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{post.title}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{post.board.name}</span>
            <span className="flex items-center gap-0.5">
              <ArrowUpIcon className="h-3 w-3" />
              {post.voteCount}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            {linked && post.statusName && (
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: post.statusColor ?? '#888' }}
                />
                {post.statusName}
              </span>
            )}
            {!linked && post.similarity != null && (
              <span className="text-muted-foreground">
                {Math.round(post.similarity * 100)}% match
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          {linked ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleAction}
              disabled={loading}
            >
              {loading ? (
                <Loader2Icon className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <UnlinkIcon className="mr-1 h-3 w-3" />
                  Unlink
                </>
              )}
            </Button>
          ) : onLink ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleAction}
              disabled={loading}
            >
              {loading ? (
                <Loader2Icon className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <LinkIcon className="mr-1 h-3 w-3" />
                  Link
                </>
              )}
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckIcon className="h-3 w-3" />
              Linked
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
