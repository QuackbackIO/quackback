/**
 * The people subscribed to a post, in the post modal's sidebar: an avatar row
 * that opens the full list, and, for a teammate with post.vote_on_behalf, a
 * people search to subscribe someone and a remove button on each row. Server
 * rules live in domains/posts/post.subscribers.ts.
 */
import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useIntl, type IntlShape } from 'react-intl'
import { toast } from 'sonner'
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/16/solid'
import type { PostId, PrincipalId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { adminQueries } from '@/lib/client/queries/admin'
import type { listPostSubscribersFn } from '@/lib/server/functions/post-subscribers'
import {
  useAddPostSubscriber,
  useRemovePostSubscriber,
} from '@/lib/client/mutations/admin-subscriptions'
import { cn } from '@/lib/shared/utils'

type Subscriber = Awaited<ReturnType<typeof listPostSubscribersFn>>[number]

function reasonLabel(intl: IntlShape, reason: string): string {
  switch (reason) {
    case 'author':
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.author',
        defaultMessage: 'Author',
      })
    case 'vote':
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.vote',
        defaultMessage: 'Voted',
      })
    case 'comment':
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.comment',
        defaultMessage: 'Commented',
      })
    case 'owner':
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.owner',
        defaultMessage: 'Owner',
      })
    case 'added':
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.added',
        defaultMessage: 'Added by a teammate',
      })
    default:
      return intl.formatMessage({
        id: 'admin.postSubscribers.reason.manual',
        defaultMessage: 'Subscribed',
      })
  }
}

function errorMessage(intl: IntlShape, error: unknown): string {
  switch ((error as { code?: string } | null)?.code) {
    case 'SUBSCRIBER_CANNOT_SEE_POST':
      return intl.formatMessage({
        id: 'admin.postSubscribers.cannotSeePost',
        defaultMessage: 'This person cannot see this post.',
      })
    case 'INVALID_SUBSCRIBER':
      return intl.formatMessage({
        id: 'admin.postSubscribers.needsAccount',
        defaultMessage: 'Only someone with an account can be subscribed.',
      })
    default:
      return intl.formatMessage({
        id: 'admin.postSubscribers.failed',
        defaultMessage: 'That did not work. Try again.',
      })
  }
}

export function PostSubscribers({
  postId,
  canManage,
  canSearchPeople,
}: {
  postId: PostId
  /** post.vote_on_behalf: subscribe and unsubscribe other people. */
  canManage: boolean
  /** people.view: the people search the add popover runs. */
  canSearchPeople: boolean
}) {
  const intl = useIntl()
  const [listOpen, setListOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const { data: subscribers } = useQuery(adminQueries.postSubscribers(postId))
  const add = useAddPostSubscriber(postId)
  const remove = useRemovePostSubscriber(postId)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!addOpen) {
      setSearch('')
      setDebouncedSearch('')
    }
  }, [addOpen])

  const canAdd = canManage && canSearchPeople
  const { data: people = [] } = useQuery({
    ...adminQueries.searchPeople({ search: debouncedSearch || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled: addOpen && canAdd,
  })
  const subscribed = new Set(subscribers?.map((s) => s.principalId))
  const candidates = people.filter((p) => !subscribed.has(p.id as PrincipalId))

  const shown = subscribers?.slice(0, 5) ?? []
  const more = Math.max(0, (subscribers?.length ?? 0) - shown.length)

  function handleAdd(principalId: PrincipalId) {
    add.mutate(principalId, {
      onSuccess: () => setAddOpen(false),
      onError: (error) => toast.error(errorMessage(intl, error)),
    })
  }

  return (
    <div className="space-y-2">
      <span className="text-sm text-muted-foreground">
        {intl.formatMessage({ id: 'admin.postSubscribers.title', defaultMessage: 'Subscribers' })}
      </span>
      <div className="flex items-center justify-between">
        {shown.length > 0 ? (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            aria-label={intl.formatMessage({
              id: 'admin.postSubscribers.title',
              defaultMessage: 'Subscribers',
            })}
            className="flex items-center -space-x-2 transition-opacity hover:opacity-80"
          >
            {shown.map((s, i) => (
              <Avatar
                key={s.principalId}
                src={s.avatarUrl}
                name={s.displayName}
                className="h-6 w-6 text-xs ring-2 ring-background"
                style={{ zIndex: i + 1 }}
              />
            ))}
            {more > 0 && (
              <span
                className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 text-[11px] font-medium text-muted-foreground ring-2 ring-background"
                style={{ zIndex: shown.length + 1 }}
              >
                +{more}
              </span>
            )}
          </button>
        ) : (
          <span className="text-xs italic text-muted-foreground/50">
            {intl.formatMessage({
              id: 'admin.postSubscribers.none',
              defaultMessage: 'No subscribers yet',
            })}
          </span>
        )}

        {canAdd && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[13px] text-muted-foreground/60 transition-colors duration-150 hover:text-muted-foreground"
              >
                <PlusIcon className="h-3 w-3" />
                <span>
                  {intl.formatMessage({
                    id: 'admin.postSubscribers.add',
                    defaultMessage: 'Add subscriber',
                  })}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end" sideOffset={4}>
              <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
                <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'admin.postSubscribers.searchPlaceholder',
                    defaultMessage: 'Search people',
                  })}
                  className="flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div
                className="max-h-56 overflow-y-auto p-1 scrollbar-thin"
                onWheel={(e) => e.stopPropagation()}
              >
                {candidates.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground/60">
                    {intl.formatMessage({
                      id: 'admin.postSubscribers.noResults',
                      defaultMessage: 'No people found',
                    })}
                  </p>
                ) : (
                  candidates.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => handleAdd(person.id as PrincipalId)}
                      disabled={add.isPending}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors duration-100 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                    >
                      <Avatar
                        src={person.image}
                        name={person.name}
                        className="h-5 w-5 shrink-0 text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{person.name || person.email}</div>
                        {person.email && (
                          <div className="truncate text-muted-foreground/60">{person.email}</div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Dialog open={listOpen} onOpenChange={setListOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {intl.formatMessage({
                  id: 'admin.postSubscribers.title',
                  defaultMessage: 'Subscribers',
                })}{' '}
                ({subscribers?.length ?? 0})
              </DialogTitle>
              <DialogDescription>
                {intl.formatMessage({
                  id: 'admin.postSubscribers.description',
                  defaultMessage:
                    "The people who get this post's updates. Someone who can no longer see the post stays on the list but is not notified.",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="-mx-6 max-h-[400px] space-y-3 overflow-y-auto px-6">
              {(subscribers ?? []).map((s) => (
                <SubscriberRow
                  key={s.principalId}
                  subscriber={s}
                  canRemove={canManage}
                  removing={remove.isPending && remove.variables === s.principalId}
                  onRemove={() =>
                    remove.mutate(s.principalId, {
                      onError: (error) => toast.error(errorMessage(intl, error)),
                    })
                  }
                />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function SubscriberRow({
  subscriber,
  canRemove,
  removing,
  onRemove,
}: {
  subscriber: Subscriber
  canRemove: boolean
  removing: boolean
  onRemove: () => void
}) {
  const intl = useIntl()
  const name = subscriber.displayName || subscriber.email || '?'
  const level =
    subscriber.level === 'status_only'
      ? intl.formatMessage({
          id: 'admin.postSubscribers.level.statusOnly',
          defaultMessage: 'Status changes only',
        })
      : intl.formatMessage({
          id: 'admin.postSubscribers.level.all',
          defaultMessage: 'All activity',
        })
  return (
    <div className="group flex items-center gap-3">
      <Avatar
        src={subscriber.avatarUrl}
        name={subscriber.displayName}
        className="h-8 w-8 text-xs"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p
          className={cn(
            'truncate text-xs',
            subscriber.canView ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'
          )}
        >
          {subscriber.canView
            ? `${reasonLabel(intl, subscriber.reason)} · ${level}`
            : intl.formatMessage({
                id: 'admin.postSubscribers.cannotView',
                defaultMessage: 'Cannot see this post, not notified',
              })}
        </p>
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label={intl.formatMessage(
            { id: 'admin.postSubscribers.remove', defaultMessage: 'Unsubscribe {name}' },
            { name }
          )}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
