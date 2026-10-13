import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ClockIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { getTimeAgo } from '@/components/ui/time-ago'
import type { WorkspaceCopilotThreadSummary } from '@/lib/shared/assistant/workspace-contract'

export function ChatHistory({
  threads,
  onOpenThread,
  compact = false,
}: {
  threads: WorkspaceCopilotThreadSummary[]
  onOpenThread: (key: string) => void
  compact?: boolean
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (open) setNow(Date.now())
  }, [open])
  const label = intl.formatMessage({ id: 'ask.chat.history', defaultMessage: 'Chats' })
  const groups = [
    { id: 'today', label: intl.formatMessage({ id: 'ask.chat.today', defaultMessage: 'Today' }) },
    {
      id: 'week',
      label: intl.formatMessage({ id: 'ask.chat.week', defaultMessage: 'Previous 7 days' }),
    },
    { id: 'older', label: intl.formatMessage({ id: 'ask.chat.older', defaultMessage: 'Older' }) },
  ]
  const groupOf = (timestamp: string) => {
    const updated = new Date(timestamp)
    return updated.toDateString() === new Date(now).toDateString()
      ? 'today'
      : updated.getTime() >= now - 7 * 86400000
        ? 'week'
        : 'older'
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} aria-label={label}>
          {compact ? (
            <ClockIcon aria-hidden="true" className="size-4" />
          ) : (
            intl.formatMessage({ id: 'ask.chat.viewAll', defaultMessage: 'View all' })
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-80 max-w-[90vw] flex-col p-0">
        <SheetHeader className="border-b px-4 py-5">
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {groups.map((group) => {
            const entries = threads.filter((thread) => groupOf(thread.updatedAt) === group.id)
            return (
              entries.length > 0 && (
                <section key={group.id} className="mb-5 space-y-1">
                  <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </h3>
                  {entries.map((thread) => (
                    <button
                      key={thread.key}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onOpenThread(thread.key)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {thread.title ||
                          intl.formatMessage({
                            id: 'ask.chat.untitled',
                            defaultMessage: 'Untitled chat',
                          })}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {getTimeAgo(thread.updatedAt, intl.locale)}
                      </span>
                    </button>
                  ))}
                </section>
              )
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function RecentChats({
  threads,
  onOpenThread,
}: {
  threads: WorkspaceCopilotThreadSummary[]
  onOpenThread: (key: string) => void
}) {
  const intl = useIntl()
  if (!threads.length) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          {intl.formatMessage({ id: 'ask.chat.recent', defaultMessage: 'Recent chats' })}
        </h2>
        <ChatHistory threads={threads} onOpenThread={onOpenThread} />
      </div>
      {threads.slice(0, 3).map((thread) => (
        <button
          key={thread.key}
          type="button"
          onClick={() => onOpenThread(thread.key)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {getTimeAgo(thread.updatedAt, intl.locale)}
          </span>
        </button>
      ))}
    </section>
  )
}
