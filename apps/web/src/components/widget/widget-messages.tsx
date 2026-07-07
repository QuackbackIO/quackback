import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { motion, useReducedMotion } from 'framer-motion'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { getMyConversationsFn } from '@/lib/server/functions/conversation'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'

interface WidgetMessagesProps {
  /** Team label used when a conversation has no assigned agent. */
  teamName: string | null
  /** AI-assistant display identity; fronts unassigned conversations when set. */
  assistant: { name: string; avatarUrl: string | null } | null
  /** Open a conversation: an id opens that thread, 'new' starts a fresh one. */
  onOpenMessenger: (target?: ConversationId | 'new') => void
}

/**
 * The Messages tab — one uniform, newest-first list of the visitor's
 * conversations (every row: author avatar + name, relative time, last-message
 * preview, unread badge) with a pinned "Ask a question" pill so a visitor can
 * always start a new thread. Deliberately makes no online/offline promise here;
 * availability copy lives in the thread once a conversation is underway.
 */
export function WidgetMessages({ teamName, assistant, onOpenMessenger }: WidgetMessagesProps) {
  const intl = useIntl()
  const reduceMotion = useReducedMotion()
  const { sessionVersion } = useWidgetAuth()
  const { data, isLoading } = useQuery({
    // Re-keyed on sessionVersion so the list refreshes after identify merges
    // the visitor's anonymous threads onto their account.
    queryKey: conversationKeys.widgetConversationList(sessionVersion),
    // Forward the widget Bearer token, or token-authed visitors fail the
    // server-side hasAuthCredentials() guard and always get an empty list.
    queryFn: () => getMyConversationsFn({ headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
  })

  const conversations = data?.conversations ?? []
  // Unassigned conversations are fronted by the assistant identity (AI-first),
  // falling back to the team label.
  const fallbackName =
    assistant?.name ??
    teamName ??
    intl.formatMessage({ id: 'widget.messages.teamFallback', defaultMessage: 'Support' })
  const fallbackAvatar = assistant?.avatarUrl ?? null

  return (
    <div className="relative flex h-full flex-col">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        {conversations.length > 0 ? (
          <ul className="px-3 pt-1 pb-24">
            {conversations.map((c) => {
              const name = c.assignedAgent?.displayName ?? fallbackName
              const unread = c.unreadCount > 0
              return (
                <li key={c.id} className="border-b border-border/40 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenMessenger(c.id)}
                    aria-label={intl.formatMessage(
                      {
                        id: 'widget.messages.resumeAria',
                        defaultMessage: 'Open conversation with {name}',
                      },
                      { name }
                    )}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-start transition-colors hover:bg-muted/40"
                  >
                    <Avatar
                      src={c.assignedAgent?.avatarUrl ?? fallbackAvatar}
                      name={name}
                      className="size-9 shrink-0 text-xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-sm text-foreground',
                            unread ? 'font-semibold' : 'font-medium'
                          )}
                        >
                          {name}
                        </span>
                        <TimeAgo
                          date={c.lastMessageAt}
                          className="shrink-0 text-[11px] text-muted-foreground/60"
                        />
                      </span>
                      <span
                        className={cn(
                          'block truncate text-xs',
                          unread ? 'text-foreground/80' : 'text-muted-foreground'
                        )}
                      >
                        {c.lastMessagePreview ?? (
                          <FormattedMessage
                            id="widget.messages.noPreview"
                            defaultMessage="No messages yet"
                          />
                        )}
                      </span>
                    </span>
                    {unread && (
                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          !isLoading && (
            <div className="flex h-full flex-col items-center justify-center px-6 pt-16 pb-24 text-center">
              <ChatBubbleOvalLeftEllipsisIcon className="mb-2 w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground/70">
                <FormattedMessage
                  id="widget.messages.empty"
                  defaultMessage="No conversations yet"
                />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">
                <FormattedMessage
                  id="widget.messages.emptyHint"
                  defaultMessage="Questions or feedback? We're here to help."
                />
              </p>
            </div>
          )
        )}
      </ScrollArea>

      {/* Pinned pill — always available, floating above the list. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <motion.button
          type="button"
          onClick={() => onOpenMessenger('new')}
          initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1], delay: 0.08 }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]"
        >
          <FormattedMessage id="widget.messages.ask" defaultMessage="Ask a question" />
          <ChatBubbleOvalLeftEllipsisIcon className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  )
}
