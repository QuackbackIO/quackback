import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { usePrincipalId, useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { usePermissions } from '@/lib/client/use-permissions'
import { workspaceChatStarters } from '@/lib/shared/workspace-starters'
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
import { RecentChats } from './chat-history'
import { HomeStreamBridge, type HomeStreamTransport } from './home-stream-bridge'
import { WorkspaceChatThread, type DraftTurn } from './workspace-chat-thread'
import { Button } from '@/components/ui/button'
import { ChatComposer } from './chat-composer'
import { HomeColumn, HomeHeaderSpace } from '../home-frame'

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
  initialQuestion?: string
  canAsk: boolean
  header: ReactNode
  /**
   * Copilot is paused for the period: this says so in the composer's place,
   * in plain sight.
   */
  paused?: ReactNode
  /** What waits on the teammate, above their last chat. */
  waiting?: ReactNode
  below?: ReactNode
}

export function CopilotHome(props: CopilotHomeProps) {
  return (
    <AskMessages>
      <CopilotHomeView {...props} />
    </AskMessages>
  )
}

function CopilotHomeView({
  threadKey,
  initialQuestion,
  canAsk,
  header,
  paused,
  waiting,
  below,
}: CopilotHomeProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const principalId = usePrincipalId()
  const privateOwner = useRef(principalId)
  const sameOwner = privateOwner.current === principalId
  const permissions = usePermissions()
  const flags = useFeatureFlags()
  const starters = workspaceChatStarters(permissions, flags)
  const keys = threadKeys(principalId)
  const transport = useRef<HomeStreamTransport>(null)
  const stop = useCallback(() => transport.current?.stop(), [])
  const clear = useCallback(() => transport.current?.clear(), [])
  const start = useCallback((input: Parameters<HomeStreamTransport['start']>[0]) => {
    if (!transport.current) return Promise.reject(new Error('Chat is not ready'))
    return transport.current.start(input)
  }, [])
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (initialQuestion && !threadKey) setQuery(initialQuestion)
  }, [initialQuestion, threadKey])
  const [draft, setDraft] = useState<DraftTurn | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [instant, setInstant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The draft unmounts once the saved thread has the answer, so a finished
  // answer is announced from a region that stays mounted.
  const [announcement, setAnnouncement] = useState('')
  const busyRef = useRef(false)
  const epoch = useRef(0)
  const enteredFromHome = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const textFrame = useRef<number | null>(null)
  const bufferedText = useRef<{ epoch: number; text: string } | null>(null)
  const cancelTextFrame = useCallback(() => {
    if (textFrame.current !== null) cancelAnimationFrame(textFrame.current)
    textFrame.current = null
    bufferedText.current = null
  }, [])
  useEffect(() => {
    if (privateOwner.current === principalId) return
    privateOwner.current = principalId
    epoch.current++
    cancelTextFrame()
    stop()
    clear()
    busyRef.current = false
    setBusy(false)
    setDraft(null)
    setPending(null)
    setQuery('')
    setError(null)
    setAnnouncement('')
  }, [principalId, cancelTextFrame, stop, clear])

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
      cancelTextFrame()
      stop()
    },
    [stop, cancelTextFrame]
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

  const goHome = useCallback(() => {
    if (enteredFromHome.current) {
      enteredFromHome.current = false
      router.history.back()
    } else void router.navigate({ to: '/admin', search: {} })
  }, [router])
  const openThread = useCallback(
    (key: string) => {
      if (!threadKey) enteredFromHome.current = true
      void router.navigate({ to: '/admin', search: { copilotThread: key } })
    },
    [router, threadKey]
  )

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
  const liveDraft = sameOwner && draft && draft.threadKey === threadKey ? draft : null
  // Only a chat follows its latest message; Home itself opens at the top.
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element || !inChat || !following.current) return
    const frame = requestAnimationFrame(() => {
      if (following.current) element.scrollTop = element.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [inChat, threadKey, messages.length, liveDraft?.text, liveDraft?.final, thread.isSuccess])

  const failed = () =>
    intl.formatMessage({
      id: 'ask.chat.failed',
      defaultMessage: "Couldn't finish this answer. Try again.",
    })

  const ask = async (question: string, target?: string, keyboard = false) => {
    const trimmed = question.trim()
    if (!canAsk || !trimmed || busyRef.current) return
    const requestedAt = ++epoch.current
    busyRef.current = true
    setBusy(true)
    setInstant(keyboard)
    setError(null)
    cancelTextFrame()
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
      let terminal = false
      setDraft({ threadKey: turnKey, question: trimmed, text: '' })
      await start({
        question: trimmed,
        forwardedProps: { threadKey: turnKey },
        handlers: {
          onTextDelta: (_delta, text) => {
            if (epoch.current !== requestedAt) return
            bufferedText.current = { epoch: requestedAt, text }
            if (textFrame.current === null)
              textFrame.current = requestAnimationFrame(() => {
                textFrame.current = null
                const buffered = bufferedText.current
                bufferedText.current = null
                if (buffered?.epoch === epoch.current)
                  setDraft((previous) =>
                    previous ? { ...previous, text: buffered.text } : previous
                  )
              })
          },
          onFinal: (payload) => {
            if (epoch.current !== requestedAt) return
            terminal = true
            cancelTextFrame()
            const final = payload as WorkspaceCopilotFinalPayload
            setDraft((previous) => (previous ? { ...previous, text: final.text, final } : previous))
            setAnnouncement(final.text)
          },
          onActivity: (activity) => {
            if (epoch.current !== requestedAt) return
            setDraft((previous) =>
              previous && !previous.activities?.includes(activity)
                ? { ...previous, activities: [...(previous.activities ?? []), activity] }
                : previous
            )
          },
          onError: () => {
            if (epoch.current !== requestedAt) return
            terminal = true
            cancelTextFrame()
            setError(failed())
            setQuery((previous) => previous || trimmed)
          },
          onStreamEnd: () => {
            if (epoch.current === requestedAt && !terminal) {
              cancelTextFrame()
              setError(failed())
              setQuery((previous) => previous || trimmed)
            }
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
  const askCurrent = useRef(ask)
  askCurrent.current = ask
  const currentThread = useRef(threadKey)
  currentThread.current = threadKey
  const navigate = useCallback(
    (href: string) => {
      void router.navigate({ href })
    },
    [router]
  )
  const continueConnector = useCallback(
    (name: string) => {
      void askCurrent.current(
        intl.formatMessage(
          { id: 'ask.connector.continue', defaultMessage: 'Go ahead with {name}.' },
          { name }
        ),
        currentThread.current
      )
    },
    [intl]
  )
  const stopTurn = () => {
    epoch.current++
    cancelTextFrame()
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

  const title =
    threads.data?.find((item) => item.key === threadKey)?.title ||
    (sameOwner ? pending : null) ||
    intl.formatMessage({ id: 'ask.chat.newChat', defaultMessage: 'New chat' })
  const draftShown =
    liveDraft ?? (sameOwner && pending ? { threadKey: '', question: pending, text: '' } : null)

  return (
    <div
      data-home-copilot=""
      data-chat={inChat || undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <HomeStreamBridge key={principalId} transportRef={transport} />
      <div data-slot="copilot-announcer" aria-live="polite" className="sr-only">
        {sameOwner ? announcement : ''}
      </div>
      <div
        ref={viewport}
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
          setShowJump(!following.current)
        }}
        data-slot="copilot-viewport"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <HomeColumn>
          <Collapse open={!inChat} instant={instant}>
            <HomeHeaderSpace>{header}</HomeHeaderSpace>
            {waiting}
          </Collapse>
          <div className={cn('flex flex-col', inChat ? 'grow opacity-100' : 'grow-0 opacity-0')}>
            {inChat && (
              <WorkspaceChatThread
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
                onNavigate={navigate}
                onConnectorAllowed={continueConnector}
                onRetry={() => void ask(draftShown?.question ?? query, threadKey)}
              />
            )}
          </div>
          {!canAsk && paused && !inChat ? paused : null}
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
              {inChat && showJump && (
                <div className="mb-3 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      following.current = true
                      if (viewport.current)
                        viewport.current.scrollTop = viewport.current.scrollHeight
                      setShowJump(false)
                    }}
                  >
                    {intl.formatMessage({
                      id: 'ask.chat.jumpLatest',
                      defaultMessage: 'Jump to latest',
                    })}
                  </Button>
                </div>
              )}
              <ChatComposer
                query={sameOwner ? query : ''}
                onQueryChange={setQuery}
                canAsk={canAsk}
                busy={busy}
                onAsk={(question, keyboard) => void ask(question, threadKey, keyboard)}
                onStop={stopTurn}
                autoFocus={false}
              />
            </div>
          )}
          <Collapse open={!inChat} instant={instant}>
            <div className="space-y-6 pt-6 pb-16">
              {canAsk && starters.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {starters.map((prompt) => (
                    <Button
                      key={prompt.id}
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal py-2 text-start"
                      onClick={() => void ask(intl.formatMessage(prompt))}
                    >
                      {intl.formatMessage(prompt)}
                    </Button>
                  ))}
                </div>
              )}
              {error && !inChat && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <RecentChats threads={threads.data ?? []} onOpenThread={openThread} />
              {below}
            </div>
          </Collapse>
        </HomeColumn>
      </div>
    </div>
  )
}

/**
 * Overview content that folds away upward while a chat is open. Closed, it
 * is inert, so nothing inside it takes focus or reaches assistive tech.
 */
function Collapse({
  open,
  children,
  instant,
}: {
  open: boolean
  children: ReactNode
  instant?: boolean
}) {
  return (
    <div
      inert={!open}
      data-state={open ? 'open' : 'closed'}
      style={instant ? { transitionDuration: '0ms' } : undefined}
      className={cn(
        'grid transition-[grid-template-rows,opacity,translate,visibility] duration-[var(--duration-slow)] ease-[var(--ease-drawer)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] -translate-y-2 opacity-0'
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
