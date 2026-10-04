import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import {
  ArrowLeftIcon,
  ChatBubbleLeftIcon,
  ClockIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getTimeAgo } from '@/components/ui/time-ago'
import { MessageMarkdown } from '@/components/shared/conversation/message-markdown'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'
import { usePrincipalId } from '@/lib/client/hooks/use-root-context'
import type {
  WorkspaceCopilotFinalPayload,
  WorkspaceCopilotMessage,
} from '@/lib/shared/assistant/workspace-contract'
import {
  createWorkspaceCopilotThreadFn,
  getWorkspaceCopilotThreadFn,
  listWorkspaceCopilotThreadsFn,
} from '@/lib/server/functions/workspace-copilot'
import { AskMessages } from './ask-messages'
import { ChatComposer } from './chat-composer'
import { ConnectorCallCard } from './connector-call-card'
import { useSearchPalette, useSearchShortcutLabel } from './search-palette'
import { WorkspaceAssistantMessage } from './workspace-assistant-message'
import { WorkspaceSettingsProposalCard } from './workspace-settings-proposal-card'

type DraftTurn = {
  threadKey: string
  question: string
  text: string
  final?: WorkspaceCopilotFinalPayload
}

const threadKeys = (principalId: string | undefined) => ({
  all: ['admin', 'workspace-copilot'] as const,
  list: ['admin', 'workspace-copilot', 'threads', principalId ?? null] as const,
  thread: (key: string) =>
    ['admin', 'workspace-copilot', 'thread', principalId ?? null, key] as const,
})

/** A dialog, menu or listbox open over the chat owns Escape. */
function overlayOpen() {
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

/**
 * Home as the Copilot chat. Idle, Home is the composer with starters and a
 * Continue row; a started chat goes full screen and lives in the URL
 * (`?copilotThread=`), so Back and Esc return to Home and reload restores it.
 */
export interface CopilotHomeProps {
  threadKey?: string
  canAsk: boolean
  header: ReactNode
  /** Shortcuts under the composer, such as the launch plan's open steps. */
  chips?: ReactNode
  /**
   * Copilot is out of AI credits: the composer shows greyed out, with this
   * offer of a way to get more over it.
   */
  locked?: ReactNode
  below?: ReactNode
}

export function CopilotHome(props: CopilotHomeProps) {
  return (
    <AskMessages>
      <CopilotHomeView {...props} />
    </AskMessages>
  )
}

function CopilotHomeView({ threadKey, canAsk, header, chips, locked, below }: CopilotHomeProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const principalId = usePrincipalId()
  const keys = threadKeys(principalId)
  const { start, stop, clear } = useAguiTurn({ url: '/api/admin/assistant/workspace' })
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<DraftTurn | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The draft unmounts once the saved thread has the answer, so a finished
  // answer is announced from a region that stays mounted.
  const [announcement, setAnnouncement] = useState('')
  const busyRef = useRef(false)
  const epoch = useRef(0)
  const enteredFromHome = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  const threads = useQuery({
    queryKey: keys.list,
    queryFn: () => listWorkspaceCopilotThreadsFn(),
    staleTime: 30_000,
  })
  const thread = useQuery({
    queryKey: keys.thread(threadKey ?? ''),
    queryFn: () => getWorkspaceCopilotThreadFn({ data: { threadKey: threadKey! } }),
    enabled: threadKey !== undefined,
  })
  const inChat = threadKey !== undefined || pending !== null

  useEffect(
    () => () => {
      epoch.current++
      stop()
    },
    [stop]
  )
  useEffect(() => {
    if (draft?.final && thread.data?.messages.some((m) => m.id === draft.final?.messageId))
      setDraft(null)
  }, [draft?.final, thread.data])
  useEffect(() => {
    following.current = true
    setError(null)
    if (threadKey) setPending(null)
  }, [threadKey])

  const goHome = () => {
    if (enteredFromHome.current) {
      enteredFromHome.current = false
      router.history.back()
    } else void router.navigate({ to: '/admin', search: {} })
  }
  const openThread = (key: string) => {
    if (!threadKey) enteredFromHome.current = true
    void router.navigate({ to: '/admin', search: { copilotThread: key } })
  }

  useEffect(() => {
    if (!threadKey) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen()) return
      event.preventDefault()
      goHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const messages: WorkspaceCopilotMessage[] = threadKey ? (thread.data?.messages ?? []) : []
  const liveDraft = draft && draft.threadKey === threadKey ? draft : null
  // Only a chat follows its latest message; Home itself opens at the top.
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && inChat && following.current) element.scrollTop = element.scrollHeight
  }, [inChat, threadKey, messages.length, liveDraft?.text, liveDraft?.final, thread.isSuccess])

  const failed = () =>
    intl.formatMessage({
      id: 'ask.chat.failed',
      defaultMessage: 'Copilot could not finish. Try again.',
    })

  const ask = async (question: string, target?: string) => {
    const trimmed = question.trim()
    if (!canAsk || !trimmed || busyRef.current) return
    const requestedAt = ++epoch.current
    busyRef.current = true
    setBusy(true)
    setError(null)
    following.current = true
    let key = target
    try {
      if (!key) {
        setPending(trimmed)
        setQuery('')
        const created = await createWorkspaceCopilotThreadFn({
          data: { title: trimmed.slice(0, 120) },
        })
        if (epoch.current !== requestedAt) return
        key = created.key
        clear()
        openThread(key)
      } else setQuery('')
      const turnKey = key
      setDraft({ threadKey: turnKey, question: trimmed, text: '' })
      await start({
        question: trimmed,
        forwardedProps: { threadKey: turnKey },
        handlers: {
          onTextDelta: (_delta, text) => {
            if (epoch.current === requestedAt)
              setDraft((previous) => (previous ? { ...previous, text } : previous))
          },
          onFinal: (payload) => {
            if (epoch.current !== requestedAt) return
            const final = payload as WorkspaceCopilotFinalPayload
            setDraft((previous) => (previous ? { ...previous, text: final.text, final } : previous))
            setAnnouncement(final.text)
          },
          onError: () => {
            if (epoch.current !== requestedAt) return
            setError(failed())
            setQuery((previous) => previous || trimmed)
          },
        },
      })
    } catch (failure) {
      if (epoch.current !== requestedAt) return
      setPending(null)
      if (!(failure instanceof Error && failure.name === 'AbortError')) setError(failed())
      setQuery((previous) => previous || trimmed)
      setDraft(null)
    } finally {
      if (epoch.current === requestedAt) {
        busyRef.current = false
        setBusy(false)
        void queryClient.invalidateQueries({ queryKey: keys.all })
      }
    }
  }
  const stopTurn = () => {
    epoch.current++
    busyRef.current = false
    setBusy(false)
    stop()
  }

  const composer = useRef<HTMLDivElement>(null)
  // The one composer moves with the chat; it keeps focus on the way in and out.
  const entered = useRef(inChat)
  useEffect(() => {
    if (entered.current === inChat) return
    entered.current = inChat
    composer.current?.querySelector('textarea')?.focus()
    following.current = true
  }, [inChat])

  const latest = threads.data?.[0]
  const title =
    threads.data?.find((item) => item.key === threadKey)?.title ||
    pending ||
    intl.formatMessage({ id: 'ask.chat.name', defaultMessage: 'Copilot' })
  const draftShown = liveDraft ?? (pending ? { threadKey: '', question: pending, text: '' } : null)

  return (
    <div
      data-home-copilot=""
      data-chat={inChat || undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <div data-slot="copilot-announcer" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div
        ref={viewport}
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
        }}
        data-slot="copilot-viewport"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-6">
          <Collapse open={!inChat}>
            <div className="pt-10 pb-6 sm:pt-20">{header}</div>
          </Collapse>
          <div
            className={cn(
              'flex flex-col transition-[flex-grow,opacity] duration-300 ease-out motion-reduce:transition-none',
              inChat ? 'grow opacity-100' : 'grow-0 opacity-0'
            )}
          >
            {inChat && (
              <CopilotThread
                title={title}
                threads={threads.data ?? []}
                busy={busy}
                messages={messages}
                draft={draftShown}
                loadFailed={thread.isError}
                error={error}
                onBack={goHome}
                onNewChat={goHome}
                onOpenThread={openThread}
                onNavigate={(href) => void router.navigate({ href })}
                onConnectorAllowed={(name) =>
                  void ask(
                    intl.formatMessage(
                      { id: 'ask.connector.continue', defaultMessage: 'Go ahead with {name}.' },
                      { name }
                    ),
                    threadKey
                  )
                }
              />
            )}
          </div>
          {!canAsk && locked && !inChat && (
            <div className="relative">
              <div inert className="opacity-50 grayscale">
                <ChatComposer
                  query=""
                  onQueryChange={() => {}}
                  canAsk={false}
                  busy={false}
                  onAsk={() => {}}
                  onStop={() => {}}
                  autoFocus={false}
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center p-3">{locked}</div>
            </div>
          )}
          {canAsk && (
            <div
              ref={composer}
              data-tour="copilot"
              className={cn(
                'z-10',
                inChat &&
                  'sticky bottom-0 bg-linear-to-t from-background from-70% to-transparent pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6'
              )}
            >
              <ChatComposer
                query={query}
                onQueryChange={setQuery}
                canAsk={canAsk}
                busy={busy}
                onAsk={(question) => void ask(question, threadKey)}
                onStop={stopTurn}
                autoFocus={false}
              />
            </div>
          )}
          <Collapse open={!inChat}>
            <div className="space-y-6 pt-6 pb-16">
              {error && !inChat && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {chips}
              {latest && (
                <button
                  type="button"
                  onClick={() => openThread(latest.key)}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-start text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                >
                  <ChatBubbleLeftIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {intl.formatMessage(
                      { id: 'ask.chat.continue', defaultMessage: 'Continue: {title}' },
                      { title: latest.title }
                    )}
                  </span>
                  <span className="shrink-0 text-xs">
                    · {getTimeAgo(latest.updatedAt, intl.locale)}
                  </span>
                </button>
              )}
              {below}
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  )
}

/**
 * Overview content that folds away upward while a chat is open. Closed, it
 * is inert, so nothing inside it takes focus or reaches assistive tech.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'grid transition-[grid-template-rows,opacity,translate,visibility] duration-300 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] -translate-y-2 opacity-0'
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function CopilotThread({
  title,
  threads,
  busy,
  messages,
  draft,
  loadFailed,
  error,
  onBack,
  onNewChat,
  onOpenThread,
  onNavigate,
  onConnectorAllowed,
}: {
  title: string
  threads: { key: string; title: string }[]
  busy: boolean
  messages: WorkspaceCopilotMessage[]
  draft: DraftTurn | null
  loadFailed: boolean
  error: string | null
  onBack: () => void
  onNewChat: () => void
  onOpenThread: (key: string) => void
  onNavigate: (href: string) => void
  onConnectorAllowed: (connectorName: string) => void
}) {
  const intl = useIntl()
  const search = useSearchPalette()
  const shortcut = useSearchShortcutLabel()
  const copilot = intl.formatMessage({ id: 'ask.chat.name', defaultMessage: 'Copilot' })
  const payload = (final?: WorkspaceCopilotFinalPayload) =>
    final ? (
      <>
        {final.proposedActions.map((action) =>
          action.toolName === 'propose_settings_change' ? (
            <WorkspaceSettingsProposalCard key={action.id} action={action} />
          ) : action.connector ? (
            <ConnectorCallCard
              key={action.id}
              action={{ ...action, connector: action.connector }}
              onAllowed={onConnectorAllowed}
            />
          ) : (
            <p key={action.id} className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'ask.settings.unavailable',
                defaultMessage: 'These changes are unavailable.',
              })}
            </p>
          )
        )}
        {final.navigation.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {final.navigation.map((link) => (
              <Button
                key={link.href}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onNavigate(link.href)}
                className="bg-card shadow-raise transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:shadow-raise-hover focus-visible:ring-foreground/25"
              >
                {link.messageId
                  ? intl.formatMessage({ id: link.messageId, defaultMessage: link.label })
                  : link.label}
              </Button>
            ))}
          </div>
        )}
      </>
    ) : null
  const userBubble = 'ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 sm:max-w-[80%]'
  return (
    <>
      <header className="sticky top-0 z-10 -mx-4 flex h-14 shrink-0 items-center gap-2 bg-background px-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent sm:-mx-6 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground focus-visible:ring-foreground/25"
          onClick={onBack}
          aria-keyshortcuts="Escape"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: 'ask.chat.back', defaultMessage: 'Back' })}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium">{title}</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="focus-visible:ring-foreground/25"
          onClick={search.open}
          aria-label={intl.formatMessage({ id: 'ask.search.row', defaultMessage: 'Search' })}
          title={shortcut}
        >
          <MagnifyingGlassIcon className="size-4" aria-hidden="true" />
        </Button>
        {threads.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="focus-visible:ring-foreground/25"
                aria-label={intl.formatMessage({
                  id: 'ask.chat.history',
                  defaultMessage: 'Your conversations',
                })}
              >
                <ClockIcon className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
              {threads.map((item) => (
                <DropdownMenuItem key={item.key} onClick={() => onOpenThread(item.key)}>
                  <span className="min-w-0 truncate">{item.title || copilot}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          className="focus-visible:ring-foreground/25"
          onClick={onNewChat}
        >
          {intl.formatMessage({ id: 'ask.chat.newChat', defaultMessage: 'New chat' })}
        </Button>
      </header>
      <section aria-label={copilot} className="space-y-8 py-6">
        {loadFailed && (
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'ask.settings.unavailable',
              defaultMessage: 'These changes are unavailable.',
            })}
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.sender === 'customer' ? userBubble : 'space-y-3 leading-7'}
          >
            {message.sender === 'assistant' ? (
              <>
                <span className="text-xs font-medium">{copilot}</span>
                <WorkspaceAssistantMessage
                  text={message.text}
                  citations={message.payload?.citations ?? []}
                />
              </>
            ) : (
              <MessageMarkdown text={message.text} />
            )}
            {payload(message.payload)}
          </div>
        ))}
        {draft && (
          <>
            <div className={userBubble}>
              <MessageMarkdown text={draft.question} />
            </div>
            <div className="space-y-3 leading-7" aria-busy={busy}>
              <span className="text-xs font-medium">{copilot}</span>
              {draft.text ? (
                <WorkspaceAssistantMessage
                  text={draft.text}
                  citations={draft.final?.citations ?? []}
                  streaming={busy}
                />
              ) : (
                busy && (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'ask.chat.thinking', defaultMessage: 'Thinking…' })}
                  </p>
                )
              )}
              {payload(draft.final)}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    </>
  )
}
