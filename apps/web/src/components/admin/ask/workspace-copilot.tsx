import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { PlusIcon, StopIcon } from '@heroicons/react/24/outline'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MessageMarkdown } from '@/components/shared/conversation/message-markdown'
import { AskComposer } from './ask-composer'
import { WorkspaceCopilotContext } from './workspace-copilot-context'
import { WorkspaceSettingsProposalCard } from './workspace-settings-proposal-card'
import { usePermissions } from '@/lib/client/use-permissions'
import {
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlags,
  usePrincipalId,
} from '@/lib/client/hooks/use-root-context'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  buildAskDestinations,
  buildAskStarterPrompts,
  searchAskDestinations,
} from '@/lib/shared/ask-destinations'
import { buildLaunchTasks } from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type {
  WorkspaceCopilotFinalPayload,
  WorkspaceCopilotMessage,
} from '@/lib/shared/assistant/workspace-contract'
import { searchAskEntitiesFn } from '@/lib/server/functions/ask-search'
import {
  createWorkspaceCopilotThreadFn,
  getWorkspaceCopilotAvailabilityFn,
  getWorkspaceCopilotThreadFn,
  listWorkspaceCopilotThreadsFn,
} from '@/lib/server/functions/workspace-copilot'

type DraftTurn = {
  history: WorkspaceCopilotMessage[]
  question: string
  text: string
  final?: WorkspaceCopilotFinalPayload
}
/** The palette stays available independently of the configured assistant. */
export function WorkspaceCopilotProvider({ children }: { children: ReactNode }) {
  const intl = useIntl()
  const copilotLabel = intl.formatMessage({ id: 'ask.chat.name', defaultMessage: 'Copilot' })
  const router = useRouter()
  const queryClient = useQueryClient()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const domainsEnabled = useCloudEnabled()
  const isHome = useRouterState({ select: (state) => /^\/admin\/?$/.test(state.location.pathname) })
  const reviewThreadKey = useRouterState({
    select: (state) => new URLSearchParams(state.location.searchStr).get('copilotThread'),
  })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [threadKey, setThreadKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftTurn | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const { start, stop, clear } = useAguiTurn({ url: '/api/admin/assistant/workspace' })
  const canUseCopilot = permissions.has(PERMISSIONS.COPILOT_USE)
  const availability = useQuery({
    queryKey: ['admin', 'workspace-copilot', 'availability', principalId],
    queryFn: () => getWorkspaceCopilotAvailabilityFn(),
    staleTime: 30_000,
    enabled: canUseCopilot && (isHome || paletteOpen || panelOpen),
  })
  const canAsk = canUseCopilot && availability.data?.enabled === true
  const thread = useQuery({
    queryKey: ['admin', 'workspace-copilot', 'thread', principalId, threadKey],
    queryFn: () => getWorkspaceCopilotThreadFn({ data: { threadKey: threadKey! } }),
    enabled: canUseCopilot && threadKey !== null,
  })
  const threads = useQuery({
    queryKey: ['admin', 'workspace-copilot', 'threads', principalId],
    queryFn: () => listWorkspaceCopilotThreadsFn(),
    enabled: canUseCopilot && (isHome || panelOpen || threadKey !== null),
    staleTime: 30_000,
  })
  const launch = useQuery({ ...adminQueries.onboardingStatus(), enabled: isHome && canAsk })
  const entitySearch = useQuery({
    queryKey: ['admin', 'ask', 'search', principalId, debouncedQuery],
    queryFn: () => searchAskEntitiesFn({ data: { query: debouncedQuery } }),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
  })

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => stop, [stop])
  useEffect(() => {
    stop()
    clear()
    setThreadKey(null)
    setDraft(null)
    setError(null)
    setQuery('')
  }, [principalId, stop, clear])
  useEffect(() => {
    if (reviewThreadKey?.startsWith('workspace:') && canUseCopilot) {
      setThreadKey(reviewThreadKey)
      setDraft(null)
      setError(null)
      setPanelOpen(true)
    }
  }, [reviewThreadKey, canUseCopilot])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (
      draft?.final &&
      thread.data?.messages.some((message) => message.id === draft.final?.messageId)
    ) {
      setDraft(null)
    }
  }, [draft?.final, thread.data])

  const destinationOptions = useMemo(
    () => ({ permissions, featureFlags, billingEnabled, domainsEnabled }),
    [permissions, featureFlags, billingEnabled, domainsEnabled]
  )
  const label = (item: { messageId: string; defaultMessage: string }) =>
    intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })
  const destinations = query.trim()
    ? searchAskDestinations(query, destinationOptions, label)
    : buildAskDestinations(destinationOptions).slice(0, 8)
  const results = [
    ...destinations.map((item) => ({ id: item.id, title: label(item), href: item.href })),
    ...(query.trim() === debouncedQuery ? (entitySearch.data ?? []) : []).map((item) => ({
      ...item,
      id: `entity:${item.id}`,
    })),
  ]

  const navigate = (href: string) => {
    setPaletteOpen(false)
    setPanelOpen(false)
    setQuery('')
    void router.navigate({ href })
  }
  const ask = async (question: string) => {
    if (!canAsk || !question.trim() || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setPaletteOpen(false)
    setPanelOpen(true)
    setQuery('')
    setDraft({ history: thread.data?.messages ?? [], question: question.trim(), text: '' })
    try {
      let key = threadKey
      if (!key) {
        const created = await createWorkspaceCopilotThreadFn({
          data: { title: question.trim().slice(0, 120) },
        })
        key = created.key
        setThreadKey(key)
        clear()
      }
      await start({
        question: question.trim(),
        forwardedProps: { threadKey: key },
        handlers: {
          onTextDelta: (_delta, text) =>
            setDraft((previous) => (previous ? { ...previous, text } : previous)),
          onFinal: (payload) => {
            const final = payload as WorkspaceCopilotFinalPayload
            setDraft((previous) => (previous ? { ...previous, text: final.text, final } : previous))
          },
          onError: () => {
            setError(
              intl.formatMessage({
                id: 'ask.chat.failed',
                defaultMessage: 'Copilot could not finish. Try again.',
              })
            )
            setQuery(question)
          },
        },
      })
    } catch {
      setError(
        intl.formatMessage({
          id: 'ask.chat.failed',
          defaultMessage: 'Copilot could not finish. Try again.',
        })
      )
      setQuery(question)
    } finally {
      busyRef.current = false
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'workspace-copilot'] })
    }
  }
  const newThread = () => {
    if (busyRef.current) return
    setThreadKey(null)
    setDraft(null)
    setError(null)
    clear()
  }
  const renderPayload = (payload?: WorkspaceCopilotFinalPayload) =>
    payload ? (
      <>
        {payload.proposedActions.map((action) =>
          action.toolName === 'propose_settings_change' ? (
            <WorkspaceSettingsProposalCard key={action.id} action={action} />
          ) : (
            <p key={action.id} className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'ask.settings.unavailable',
                defaultMessage: 'These changes are unavailable.',
              })}
            </p>
          )
        )}
        {payload.navigation.map((link) => (
          <Button
            key={link.href}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(link.href)}
            className="mt-2 focus-visible:ring-foreground/25"
          >
            {link.messageId
              ? intl.formatMessage({ id: link.messageId, defaultMessage: link.label })
              : link.label}
          </Button>
        ))}
      </>
    ) : null
  const messages = draft?.history ?? thread.data?.messages ?? []
  const conversation =
    threadKey || draft || (canUseCopilot && threads.data?.length) ? (
      <section aria-label={copilotLabel} className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="focus-visible:ring-foreground/25">
                {intl.formatMessage({
                  id: 'ask.chat.history',
                  defaultMessage: 'Your conversations',
                })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(threads.data ?? []).map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  disabled={busy}
                  onClick={() => {
                    setThreadKey(item.key)
                    setDraft(null)
                    setError(null)
                    clear()
                  }}
                >
                  {item.title ||
                    intl.formatMessage({
                      id: 'ask.settings.title',
                      defaultMessage: 'Proposed changes',
                    })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={newThread}
            className="focus-visible:ring-foreground/25"
          >
            <PlusIcon className="size-4" />
            {intl.formatMessage({ id: 'ask.chat.new', defaultMessage: 'New conversation' })}
          </Button>
        </div>
        {thread.isError && (
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
            className={message.sender === 'customer' ? 'rounded-lg bg-muted p-3' : 'space-y-2'}
          >
            {message.sender === 'assistant' && (
              <span className="text-xs font-medium">{copilotLabel}</span>
            )}
            <MessageMarkdown text={message.text} />
            {renderPayload(message.payload)}
          </div>
        ))}
        {draft && (
          <>
            <div className="rounded-lg bg-muted p-3">
              <MessageMarkdown text={draft.question} />
            </div>
            <div className="space-y-2" aria-live="polite" aria-busy={busy}>
              <span className="text-xs font-medium">{copilotLabel}</span>
              {draft.text ? (
                <MessageMarkdown text={draft.text} />
              ) : (
                busy && (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'ask.chat.thinking', defaultMessage: 'Thinking…' })}
                  </p>
                )
              )}
              {renderPayload(draft.final)}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={stop}
            className="focus-visible:ring-foreground/25"
          >
            <StopIcon className="size-4" />
            {intl.formatMessage({ id: 'ask.chat.stop', defaultMessage: 'Stop' })}
          </Button>
        )}
      </section>
    ) : null
  const composer = (
    <AskComposer
      query={query}
      onQueryChange={setQuery}
      canAsk={canAsk && !busy}
      onAsk={(question) => void ask(question)}
      onNavigate={navigate}
      results={results}
      loading={entitySearch.isFetching}
      variant="home"
    />
  )
  const completed = launch.data
    ? buildLaunchTasks(
        launch.data,
        launch.data.goals ?? [launch.data.useCase ?? 'product_feedback']
      )
        .filter((task) => task.isCompleted)
        .map((task) => task.id)
    : []
  const starterPrompts = canAsk
    ? buildAskStarterPrompts(launch.data?.goals ?? ['product_feedback'], completed)
    : []
  const starters =
    starterPrompts.length > 0 && !threadKey ? (
      <div className="flex flex-wrap gap-2">
        {starterPrompts.map((prompt) => (
          <Button
            key={prompt.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className="rounded-full focus-visible:ring-foreground/25"
            onClick={() =>
              void ask(intl.formatMessage({ id: prompt.id, defaultMessage: prompt.defaultMessage }))
            }
          >
            {intl.formatMessage({ id: prompt.id, defaultMessage: prompt.defaultMessage })}
          </Button>
        ))}
      </div>
    ) : null

  return (
    <WorkspaceCopilotContext.Provider
      value={{ composer, conversation, starters, openPalette: () => setPaletteOpen(true) }}
    >
      {children}
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="max-w-xl gap-0 p-0 [&>button]:top-3 [&>button]:right-3">
          <DialogTitle className="sr-only">
            {intl.formatMessage({ id: 'ask.composer.search', defaultMessage: 'Search Quackback' })}
          </DialogTitle>
          <AskComposer
            query={query}
            onQueryChange={setQuery}
            canAsk={canAsk && !busy}
            onAsk={(question) => void ask(question)}
            onNavigate={navigate}
            results={results}
            loading={entitySearch.isFetching}
          />
        </DialogContent>
      </Dialog>
      <Sheet open={panelOpen && !isHome} onOpenChange={setPanelOpen}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{copilotLabel}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 px-4">{conversation}</ScrollArea>
          <div className="p-4">{composer}</div>
        </SheetContent>
      </Sheet>
    </WorkspaceCopilotContext.Provider>
  )
}
