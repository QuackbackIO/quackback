import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { adminQueries } from '@/lib/client/queries/admin'
import { buildAskStarterPrompts } from '@/lib/shared/ask-destinations'
import { buildLaunchTasks } from '@/lib/shared/launch-checklist'
import type {
  WorkspaceCopilotFinalPayload,
  WorkspaceCopilotMessage,
} from '@/lib/shared/assistant/workspace-contract'
import {
  createWorkspaceCopilotThreadFn,
  getWorkspaceCopilotThreadFn,
  listWorkspaceCopilotThreadsFn,
} from '@/lib/server/functions/workspace-copilot'
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
export function CopilotHome({
  threadKey,
  canAsk,
  header,
  below,
}: {
  threadKey?: string
  canAsk: boolean
  header: ReactNode
  below?: ReactNode
}) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const principalId = usePrincipalId()
  const keys = threadKeys(principalId)
  const { start, stop, clear } = useAguiTurn({ url: '/api/admin/assistant/workspace' })
  const [homeQuery, setHomeQuery] = useState('')
  const [chatQuery, setChatQuery] = useState('')
  const [draft, setDraft] = useState<DraftTurn | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [homeFocus, setHomeFocus] = useState(false)
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
  const launch = useQuery({ ...adminQueries.onboardingStatus(), enabled: canAsk && !threadKey })
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
    setHomeFocus(true)
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
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [threadKey, messages.length, liveDraft?.text, liveDraft?.final, thread.isSuccess])

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
        setHomeQuery('')
        const created = await createWorkspaceCopilotThreadFn({
          data: { title: trimmed.slice(0, 120) },
        })
        if (epoch.current !== requestedAt) return
        key = created.key
        clear()
        openThread(key)
      } else setChatQuery('')
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
          },
          onError: () => {
            if (epoch.current !== requestedAt) return
            setError(failed())
            setChatQuery((previous) => previous || trimmed)
          },
        },
      })
    } catch (failure) {
      if (epoch.current !== requestedAt) return
      setPending(null)
      if (!(failure instanceof Error && failure.name === 'AbortError')) setError(failed())
      if (key) setChatQuery((previous) => previous || trimmed)
      else setHomeQuery((previous) => previous || trimmed)
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

  if (inChat)
    return (
      <CopilotChat
        title={
          threads.data?.find((item) => item.key === threadKey)?.title ||
          pending ||
          intl.formatMessage({ id: 'ask.chat.name', defaultMessage: 'Copilot' })
        }
        threads={threads.data ?? []}
        busy={busy}
        canAsk={canAsk}
        messages={messages}
        draft={liveDraft ?? (pending ? { threadKey: '', question: pending, text: '' } : null)}
        loadFailed={thread.isError}
        error={error}
        query={chatQuery}
        onQueryChange={setChatQuery}
        onAsk={(question) => void ask(question, threadKey)}
        onStop={stopTurn}
        onHome={goHome}
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
        viewportRef={viewport}
        onScroll={(element) => {
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
        }}
      />
    )

  const latest = threads.data?.[0]
  const completed = launch.data
    ? buildLaunchTasks(
        launch.data,
        launch.data.goals ?? [launch.data.useCase ?? 'product_feedback']
      )
        .filter((task) => task.isCompleted)
        .map((task) => task.id)
    : []
  const starters = canAsk
    ? buildAskStarterPrompts(launch.data?.goals ?? ['product_feedback'], completed)
    : []
  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-10 pb-16 sm:px-6 sm:pt-20">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {header}
          {canAsk && (
            <div data-tour="copilot">
              <ChatComposer
                query={homeQuery}
                onQueryChange={setHomeQuery}
                canAsk={canAsk}
                busy={busy}
                onAsk={(question) => void ask(question)}
                onStop={stopTurn}
                autoFocus={homeFocus}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {starters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {starters.map((prompt) => {
                const text = intl.formatMessage({
                  id: prompt.id,
                  defaultMessage: prompt.defaultMessage,
                })
                return (
                  <Button
                    key={prompt.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="max-w-full rounded-full text-[13px] font-normal focus-visible:ring-foreground/25"
                    onClick={() => void ask(text)}
                  >
                    {text}
                  </Button>
                )
              })}
            </div>
          )}
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
      </div>
    </ScrollArea>
  )
}

function CopilotChat({
  title,
  threads,
  busy,
  canAsk,
  messages,
  draft,
  loadFailed,
  error,
  query,
  onQueryChange,
  onAsk,
  onStop,
  onHome,
  onNewChat,
  onOpenThread,
  onNavigate,
  onConnectorAllowed,
  viewportRef,
  onScroll,
}: {
  title: string
  threads: { key: string; title: string }[]
  busy: boolean
  canAsk: boolean
  messages: WorkspaceCopilotMessage[]
  draft: DraftTurn | null
  loadFailed: boolean
  error: string | null
  query: string
  onQueryChange: (query: string) => void
  onAsk: (question: string) => void
  onStop: () => void
  onHome: () => void
  onNewChat: () => void
  onOpenThread: (key: string) => void
  onNavigate: (href: string) => void
  onConnectorAllowed: (connectorName: string) => void
  viewportRef: RefObject<HTMLDivElement | null>
  onScroll: (element: HTMLElement) => void
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
                className="focus-visible:ring-foreground/25"
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
    <div className="flex h-full min-h-0 flex-col bg-background" data-copilot-focused="">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground focus-visible:ring-foreground/25"
          onClick={onHome}
          aria-keyshortcuts="Escape"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: 'ask.destination.home', defaultMessage: 'Home' })}
          <kbd className="hidden text-[11px] text-muted-foreground sm:inline">Esc</kbd>
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
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewportRef}
        onScrollCapture={(event) => onScroll(event.target as HTMLElement)}
      >
        <section
          aria-label={copilot}
          className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-10"
        >
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
              <div className="space-y-3 leading-7" aria-live="polite" aria-busy={busy}>
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
      </ScrollArea>
      {canAsk && (
        <div className="shrink-0 bg-background px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          <div className="mx-auto w-full max-w-3xl">
            <ChatComposer
              query={query}
              onQueryChange={onQueryChange}
              canAsk={canAsk}
              busy={busy}
              onAsk={onAsk}
              onStop={onStop}
            />
          </div>
        </div>
      )}
    </div>
  )
}
