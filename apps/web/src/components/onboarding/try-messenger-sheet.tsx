import { useCallback, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
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
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '@/lib/shared/i18n'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'
import {
  getTestCustomerOverviewFn,
  mintTestCustomerPhoneLinkFn,
  mintTestCustomerTokenFn,
} from '@/lib/server/functions/test-customer'
import { cn } from '@/lib/shared/utils'
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[1200px]">
        <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4 pr-12">
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
        </header>
        {open && <TryMessengerBody start={start} />}
      </SheetContent>
    </Sheet>
  )
}

function TryMessengerBody({ start }: { start: TryMessengerStart }) {
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
      if (evt.kind === 'assistant_activity' || evt.kind === 'assistant_delta') return
      reconcileCachedThread<AgentThreadCache>(
        queryClient,
        conversationKeys.agentThread(id),
        (prev) => applyAgentThreadEvent(prev, evt, id)
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

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[380px_minmax(0,1fr)_300px] lg:overflow-hidden">
      <section className="flex min-h-0 flex-col border-b bg-muted/40 p-4 lg:border-r lg:border-b-0">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          <FormattedMessage id="onboarding.test.customerSide" defaultMessage="Your customer" />
        </p>
        <div className="relative min-h-[520px] flex-1 overflow-hidden rounded-[28px] border bg-background shadow-sm">
          <TestCustomerFrame
            key={frameKey}
            getToken={getToken}
            open={frameOpen}
            onStatusChange={setStatus}
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

      <section className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            <FormattedMessage id="onboarding.test.inboxSide" defaultMessage="Your inbox" />
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
        {conversationId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentConversationThread
              key={conversationId}
              item={{ kind: 'conversation', id: conversationId }}
              targetMessageId={null}
              onChanged={() => {}}
              onBack={() => {}}
              onSelectItem={() => {}}
              onOpenPost={() => {}}
              isVisitorTyping={false}
              isOtherAgentTyping={false}
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
                  defaultMessage="Send the message on the left. It lands here."
                />
              )}
            </p>
          </div>
        )}
      </section>

      <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto p-5">
        {steps.seen ? (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">
              <FormattedMessage id="onboarding.test.done" defaultMessage="That's the round trip" />
            </p>
            <Button asChild size="sm">
              <Link to="/admin/settings/widget/install">
                <FormattedMessage
                  id="onboarding.test.install"
                  defaultMessage="Put Messenger on your site"
                />
              </Link>
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

        <PhoneCode locale={locale} />

        {overview.data?.testEmailAddress && (
          <EmailAddress address={overview.data.testEmailAddress} />
        )}
      </aside>
    </div>
  )
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

function PhoneCode({ locale }: { locale: SupportedLocale }) {
  const mint = useMutation({
    mutationFn: async () => {
      const { url } = await mintTestCustomerPhoneLinkFn({ data: { locale } })
      return QRCode.toDataURL(url, { margin: 1, width: 192 })
    },
  })
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        <FormattedMessage id="onboarding.test.phone" defaultMessage="Try it on your phone" />
      </p>
      {mint.data ? (
        <>
          <img
            src={mint.data}
            alt=""
            className="size-48 rounded-lg border bg-white p-2"
            data-testid="try-messenger-qr"
          />
          <p className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.test.phoneHint"
              defaultMessage="Single use. Expires in 10 minutes."
            />
          </p>
          <Button size="sm" variant="ghost" onClick={() => mint.mutate()} disabled={mint.isPending}>
            <FormattedMessage id="onboarding.test.phoneNew" defaultMessage="New code" />
          </Button>
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
