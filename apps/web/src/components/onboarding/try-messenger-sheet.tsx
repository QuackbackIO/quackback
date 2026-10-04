import { useCallback, useEffect, useRef, useState } from 'react'
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AgentConversationThread } from '@/components/conversation/agent-conversation-thread'
import {
  applyAgentThreadEvent,
  type AgentThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import { reconcileCachedThread } from '@/lib/client/conversation/reconcile-cached-thread'
import { useConversationStream } from '@/lib/client/hooks/use-conversation-stream'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '@/lib/shared/i18n'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'
import {
  getTestCustomerOverviewFn,
  getTestCustomerPhoneLinkStatusFn,
  mintTestCustomerPhoneLinkFn,
  mintTestCustomerTokenFn,
} from '@/lib/server/functions/test-customer'
import { cn } from '@/lib/shared/utils'
import { openGoingLiveSheet } from './going-live-events'
import { applyQuinnPreview } from './quinn-preview'
import {
  TestCustomerFrame,
  type TestCustomerFrameOpen,
  type TestCustomerFrameStatus,
} from './test-customer-frame'

export type TryMessengerStart = 'message' | 'idea'

const OVERVIEW_KEY = ['onboarding', 'test-customer'] as const

export function TryMessengerSheet({
  open,
  onOpenChange,
  start = 'message',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  start?: TryMessengerStart
}) {
  const headingRef = useRef<HTMLElement>(null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[1200px]"
        // Land on the heading: a ringed tab on open reads as a second selection.
        initialFocus={headingRef}
      >
        <header
          ref={headingRef}
          tabIndex={-1}
          className="flex shrink-0 items-center gap-3 border-b px-5 py-4 pr-12 outline-none"
        >
          <SheetTitle>
            <FormattedMessage id="onboarding.test.title" defaultMessage="Try Messenger" />
          </SheetTitle>
          <Badge variant="secondary">
            <FormattedMessage id="onboarding.test.badge" defaultMessage="Test" />
          </Badge>
          <SheetDescription className="sr-only">
            <FormattedMessage
              id="onboarding.test.subtitle"
              defaultMessage="See both sides of a conversation."
            />
          </SheetDescription>
          <span className="ml-auto hidden text-xs text-muted-foreground lg:inline" aria-hidden>
            <FormattedMessage
              id="onboarding.test.escHint"
              defaultMessage="Esc closes, even inside Messenger"
            />
          </span>
        </header>
        {open && (
          <TryMessengerBody
            start={start}
            onClose={() => onOpenChange(false)}
            onPutOnSite={() => {
              onOpenChange(false)
              openGoingLiveSheet('install-messenger')
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

type TryMessengerPane = 'customer' | 'inbox'
const PANES: TryMessengerPane[] = ['customer', 'inbox']

function TryMessengerBody({
  start,
  onClose,
  onPutOnSite,
}: {
  start: TryMessengerStart
  onClose: () => void
  onPutOnSite: () => void
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const locale = normalizeLocale(intl.locale) ?? DEFAULT_LOCALE
  const [frameKey, setFrameKey] = useState(0)
  const [status, setStatus] = useState<TestCustomerFrameStatus>('connecting')
  const [postId, setPostId] = useState<string | null>(null)
  // The thread this frame's first message opened; until then, the latest one.
  const [startedId, setStartedId] = useState<ConversationId | null>(null)

  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => getTestCustomerOverviewFn() })
  const conversationId =
    startedId ?? ((overview.data?.conversationId ?? null) as ConversationId | null)

  const { data: thread } = useQuery<AgentThreadCache>({
    queryKey: conversationKeys.agentThread(conversationId ?? ('' as ConversationId)),
    queryFn: skipToken,
    enabled: !!conversationId,
  })
  const steps = roundTripSteps(conversationId, thread)
  // Below lg the sheet shows one side at a time; both stay mounted so the
  // customer's frame keeps its session while the inbox is in view.
  const [pane, setPane] = useState<TryMessengerPane>('customer')
  const wide = useMediaQuery('(min-width: 1024px)')
  // The other side has something waiting: a message to answer, or a reply to read.
  const fresh: Record<TryMessengerPane, boolean> = {
    inbox: pane !== 'inbox' && steps.sent && !steps.replied,
    customer: pane !== 'customer' && steps.replied && !steps.seen,
  }

  useConversationStream({
    enabled: true,
    buildUrl: async () => '/api/chat/stream?scope=inbox',
    onEvent: (evt: ConversationStreamEvent) => {
      const id =
        evt.kind === 'conversation'
          ? evt.conversation.id
          : 'conversationId' in evt
            ? evt.conversationId
            : undefined
      if (!id || evt.kind === 'typing') return
      if (id !== conversationId) {
        if (!startedId) void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY })
        return
      }
      if (evt.kind === 'assistant_activity') return
      // Quinn's live turn streams into the inbox pane, then its reply replaces it.
      reconcileCachedThread<AgentThreadCache>(
        queryClient,
        conversationKeys.agentThread(id),
        (prev) => {
          const live = applyQuinnPreview(prev, evt)
          return evt.kind === 'assistant_delta' ? live : applyAgentThreadEvent(live, evt, id)
        }
      )
    },
  })

  const getToken = useCallback(
    () => mintTestCustomerTokenFn({ data: { locale } }).then((r) => r.token),
    [locale]
  )
  const frameOpen: TestCustomerFrameOpen =
    start === 'idea'
      ? { view: 'new-post' }
      : {
          view: 'chat',
          body: intl.formatMessage({
            id: 'onboarding.test.draft',
            defaultMessage: 'Hi! Is anyone there?',
          }),
        }

  const tabLabel = (key: TryMessengerPane) =>
    key === 'customer'
      ? intl.formatMessage({ id: 'onboarding.test.tab.customer', defaultMessage: 'Customer' })
      : intl.formatMessage({ id: 'onboarding.test.tab.inbox', defaultMessage: 'Inbox' })
  const paneProps = (key: TryMessengerPane) =>
    wide
      ? { id: `try-messenger-${key}` }
      : {
          id: `try-messenger-${key}`,
          role: 'tabpanel',
          'aria-labelledby': `try-messenger-${key}-tab`,
        }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[380px_minmax(0,1fr)_300px] lg:overflow-hidden">
      <div
        role="tablist"
        aria-label={intl.formatMessage({
          id: 'onboarding.test.tabs',
          defaultMessage: 'Side of the conversation',
        })}
        className="mx-4 mt-3 grid shrink-0 grid-cols-2 rounded-xl bg-muted p-1 lg:hidden"
      >
        {PANES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`try-messenger-${key}-tab`}
            aria-selected={pane === key}
            aria-controls={`try-messenger-${key}`}
            tabIndex={pane === key ? 0 : -1}
            onClick={() => setPane(key)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = PANES[(PANES.indexOf(key) + 1) % PANES.length]
              setPane(next)
              document.getElementById(`try-messenger-${next}-tab`)?.focus()
            }}
            className={cn(
              'flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/50',
              pane === key ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            {tabLabel(key)}
            {fresh[key] && (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                <span className="sr-only">
                  {intl.formatMessage({ id: 'onboarding.test.tab.new', defaultMessage: ', new' })}
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      <section
        {...paneProps('customer')}
        className={cn(
          'flex min-h-0 flex-1 flex-col p-4 lg:border-r lg:bg-muted/40',
          pane !== 'customer' && 'max-lg:hidden'
        )}
      >
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          <FormattedMessage
            id="onboarding.test.customerSide"
            defaultMessage="Your Messenger, as a test customer"
          />
        </p>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] border bg-background shadow-sm lg:min-h-[520px]">
          <TestCustomerFrame
            key={frameKey}
            getToken={getToken}
            open={frameOpen}
            onStatusChange={setStatus}
            onClose={onClose}
            onEvent={(name, payload) => {
              const id = (payload as { id?: unknown } | null)?.id
              if (typeof id !== 'string') return
              if (name === 'post:created') setPostId(id)
              if (name === 'conversation:started') setStartedId(id as ConversationId)
            }}
            title={intl.formatMessage({
              id: 'onboarding.test.frameTitle',
              defaultMessage: 'Messenger as a test customer',
            })}
          />
          {status === 'expired' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                <FormattedMessage
                  id="onboarding.test.frameExpired"
                  defaultMessage="The test session ended."
                />
              </p>
              <Button size="sm" variant="outline" onClick={() => setFrameKey((k) => k + 1)}>
                <FormattedMessage id="onboarding.test.restart" defaultMessage="Start again" />
              </Button>
            </div>
          )}
        </div>
      </section>

      <section
        {...paneProps('inbox')}
        className={cn(
          'flex min-h-0 flex-1 flex-col lg:border-r',
          pane !== 'inbox' && 'max-lg:hidden'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            <FormattedMessage
              id="onboarding.test.inboxSide"
              defaultMessage="The same conversation in your inbox"
            />
          </p>
          {conversationId && (
            <Link
              to="/admin/inbox"
              search={{ i: conversationId }}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <FormattedMessage id="onboarding.test.openInbox" defaultMessage="Open in inbox" />
            </Link>
          )}
        </div>
        {conversationId && quinnAnsweredFirst(thread) && !steps.replied && (
          <p className="border-b px-5 py-2 text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.test.quinnFirst"
              defaultMessage="Quinn answered first. Your reply still counts."
            />
          </p>
        )}
        {conversationId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentConversationThread
              key={conversationId}
              item={{ kind: 'conversation', id: conversationId }}
              targetMessageId={null}
              onChanged={() => {}}
              // Its back arrow shows only where one side fits: go back to the customer.
              onBack={() => setPane('customer')}
              onSelectItem={() => {}}
              onOpenPost={() => {}}
              isVisitorTyping={false}
              isOtherAgentTyping={false}
              replyFirst
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {start === 'idea' && postId ? (
                <Link
                  to="/admin/feedback"
                  search={{ post: postId }}
                  className="text-foreground underline"
                >
                  <FormattedMessage
                    id="onboarding.test.openIdea"
                    defaultMessage="Your test idea is in Feedback. Open it."
                  />
                </Link>
              ) : (
                <FormattedMessage
                  id="onboarding.test.waiting"
                  defaultMessage="Send a message as your customer. It lands here."
                />
              )}
            </p>
          </div>
        )}
      </section>

      <aside className="flex max-h-[40dvh] shrink-0 flex-col gap-6 overflow-y-auto border-t p-5 lg:max-h-none lg:min-h-0 lg:border-t-0">
        <p role="status" className="sr-only" data-testid="round-trip-live">
          {roundTripAnnouncement(steps, intl)}
        </p>
        {steps.seen ? (
          <div className="space-y-3 rounded-xl border bg-card p-4" data-testid="round-trip-done">
            <div className="flex items-center gap-2">
              <CheckCircleIcon
                className="size-6 shrink-0 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500"
                aria-hidden
              />
              <p className="text-sm font-medium">
                <FormattedMessage
                  id="onboarding.test.done"
                  defaultMessage="That's the round trip"
                />
              </p>
            </div>
            <Button
              size="sm"
              className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700"
              onClick={onPutOnSite}
            >
              <FormattedMessage
                id="onboarding.test.install"
                defaultMessage="Put Messenger on your site"
              />
            </Button>
          </div>
        ) : (
          <ol className="space-y-3">
            <RoundTripStep done={steps.sent} index={1}>
              <FormattedMessage
                id="onboarding.test.step.send"
                defaultMessage="Send a message as your customer."
              />
            </RoundTripStep>
            <RoundTripStep done={steps.replied} index={2}>
              <FormattedMessage
                id="onboarding.test.step.reply"
                defaultMessage="Reply from your inbox."
              />
            </RoundTripStep>
            <RoundTripStep done={steps.seen} index={3}>
              <FormattedMessage
                id="onboarding.test.step.seen"
                defaultMessage="Watch your reply arrive and get read."
              />
            </RoundTripStep>
          </ol>
        )}

        {/* A phone is already the second device: no code to scan there. */}
        <div className="max-sm:hidden">
          <PhoneCode locale={locale} />
        </div>

        {overview.data?.testEmailAddress && (
          <EmailAddress address={overview.data.testEmailAddress} />
        )}
      </aside>
    </div>
  )
}

/** What a screen reader hears as the round trip moves on. */
function roundTripAnnouncement(steps: ReturnType<typeof roundTripSteps>, intl: IntlShape): string {
  if (steps.seen)
    return intl.formatMessage({ id: 'onboarding.test.done', defaultMessage: "That's the round trip" })
  const done = steps.replied ? 2 : steps.sent ? 1 : 0
  if (done === 0) return ''
  return intl.formatMessage(
    { id: 'onboarding.test.stepDone', defaultMessage: 'Step {step} of 3 done.' },
    { step: done }
  )
}

/** Quinn replied before any teammate did. */
export function quinnAnsweredFirst(thread: AgentThreadCache | undefined): boolean {
  return !!thread?.messages.some((m) => m.senderType === 'agent' && m.isAssistant)
}

/** The round trip, read from the live thread: customer sent, a person replied, the customer read it. */
export function roundTripSteps(
  conversationId: string | null,
  thread: AgentThreadCache | undefined
) {
  const reply = thread?.messages.findLast(
    (m) => m.senderType === 'agent' && !m.isAssistant && !m.isInternal
  )
  const readAt = thread?.conversation.visitorLastReadAt
  return {
    sent: !!conversationId,
    replied: !!reply,
    seen: !!reply && !!readAt && new Date(readAt) >= new Date(reply.createdAt),
  }
}

/** One step of the round trip: a check and muted text once done. */
export function RoundTripStep({
  done,
  index,
  children,
}: {
  done: boolean
  index: number
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3 text-sm">
      {done ? (
        <CheckCircleIcon className="size-5 shrink-0 text-primary" aria-hidden />
      ) : (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground"
          aria-hidden
        >
          {index}
        </span>
      )}
      <span className={cn(done && 'text-muted-foreground')}>{children}</span>
    </li>
  )
}

/** How often a shown phone code checks whether it was scanned or ran out. */
export const PHONE_CODE_POLL_MS = 3000

function PhoneCode({ locale }: { locale: SupportedLocale }) {
  const mint = useMutation({
    mutationFn: async () => {
      const { url, token } = await mintTestCustomerPhoneLinkFn({ data: { locale } })
      return { token, src: await QRCode.toDataURL(url, { margin: 1, width: 192 }) }
    },
  })
  const token = mint.data?.token ?? null
  // A code works once and for ten minutes: when the phone has used it, or it
  // ran out, the next one replaces it here.
  const status = useQuery({
    queryKey: ['onboarding', 'phone-code', token],
    queryFn: () => getTestCustomerPhoneLinkStatusFn({ data: { token: token! } }),
    enabled: !!token,
    refetchInterval: PHONE_CODE_POLL_MS,
  })
  const spent = status.data?.pending === false
  const { mutate, isPending, isError } = mint
  useEffect(() => {
    if (spent && !isPending && !isError) mutate()
  }, [spent, isPending, isError, mutate])

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        <FormattedMessage id="onboarding.test.phone" defaultMessage="Try it on your phone" />
      </p>
      {mint.data ? (
        <>
          <img
            src={mint.data.src}
            alt=""
            className={cn('size-48 rounded-lg border bg-white p-2', spent && 'opacity-30')}
            data-testid="try-messenger-qr"
          />
          <p className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.test.phoneHint"
              defaultMessage="One use, valid 10 minutes. A new code appears here once it is used."
            />
          </p>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => mint.mutate()} disabled={mint.isPending}>
          <FormattedMessage id="onboarding.test.phoneShow" defaultMessage="Show code" />
        </Button>
      )}
    </div>
  )
}

function EmailAddress({ address }: { address: string }) {
  const intl = useIntl()
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        <FormattedMessage id="onboarding.test.email" defaultMessage="Or email this address" />
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1 text-xs">
          {address}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(address)
              .then(() =>
                toast.success(
                  intl.formatMessage({ id: 'onboarding.test.copied', defaultMessage: 'Copied' })
                )
              )
          }
        >
          <FormattedMessage id="onboarding.test.copy" defaultMessage="Copy" />
        </Button>
      </div>
    </div>
  )
}
