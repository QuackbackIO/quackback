/**
 * Quinn Copilot: a private, teammate-facing Q&A thread scoped to a single
 * conversation (COPILOT-SIDEBAR-UX.md). Renders inside the inbox detail
 * panel's "Copilot" tab (conversation-detail-panel.tsx). Streams against
 * POST /api/admin/assistant/copilot (copilot.v1.* SSE events, cloned from the
 * admin assistant sandbox's fetch/SSE/patch-last-turn shape), reuses
 * AssistantAnswer for citation rendering, and gates any internal-sourced
 * answer behind a hard confirm before it can reach a customer-facing
 * composer (B.4's leak gate) — "Add as note" never confirms, from anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  BoltIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  FunnelIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MapIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  AssistantAnswer,
  AssistantWorkingTrace,
} from '@/components/shared/conversation/assistant-turn'
import { useSseTurn } from '@/lib/client/hooks/use-sse-turn'
import { settingsQueries } from '@/lib/client/queries/settings'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  COPILOT_EVENTS,
  type CopilotActivityPayload,
  type CopilotCitation,
  type CopilotDeltaPayload,
  type CopilotErrorPayload,
  type CopilotFinalPayload,
  type CopilotHistoryEntry,
} from '@/lib/shared/assistant/copilot-contract'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_ENTRIES = 20
const GENERIC_ERROR = 'Something went wrong. Try again.'

type SourceType = CopilotCitation['type']
type InsertMode = 'reply' | 'note'

interface CopilotTurn {
  id: string
  question: string
  answer: string
  citations: CopilotCitation[]
  internalSourced: boolean
  suppressed?: string
  status: 'streaming' | 'done' | 'error'
  activity: AssistantActivityStatus | null
  errorMessage?: string
}

interface SourceOption {
  type: SourceType
  /** Plural — the Answer-sources popover's filter row. */
  label: string
  /** Singular — the per-citation source row's hovercard meta line. */
  rowLabel: string
  subtitle?: string
  icon: typeof BookOpenIcon
  flagKey?: keyof FeatureFlags
}

// Single source of truth for each source type's icon + labels: the popover
// filter list and the citation-row hovercard both read off this one table
// instead of keeping their own icon/label maps in sync by hand.
const SOURCE_OPTIONS: SourceOption[] = [
  {
    type: 'article',
    label: 'Help center articles',
    rowLabel: 'Help center article',
    icon: BookOpenIcon,
  },
  {
    type: 'snippet',
    label: 'Snippets',
    rowLabel: 'Snippet',
    icon: DocumentTextIcon,
    flagKey: 'assistantSnippets',
  },
  {
    type: 'post',
    label: 'Roadmap posts',
    rowLabel: 'Roadmap post',
    icon: MapIcon,
    flagKey: 'assistantPostGrounding',
  },
  {
    type: 'summary',
    label: 'Past conversations',
    rowLabel: 'Past conversation',
    subtitle: "This customer's closed conversations",
    icon: ChatBubbleLeftRightIcon,
    flagKey: 'assistantConversationGrounding',
  },
]

const SOURCE_TYPE_META: Record<SourceType, { icon: typeof BookOpenIcon; label: string }> =
  Object.fromEntries(
    SOURCE_OPTIONS.map((opt) => [opt.type, { icon: opt.icon, label: opt.rowLabel }])
  ) as Record<SourceType, { icon: typeof BookOpenIcon; label: string }>

function visibleSourceOptions(flags: FeatureFlags | undefined): SourceOption[] {
  return SOURCE_OPTIONS.filter((opt) => !opt.flagKey || flags?.[opt.flagKey])
}

function copilotSourcesStorageKey(principalId: string): string {
  return `quackback:copilot-sources:${principalId}`
}

/** The Answer-sources filter selection: all visible types checked by default,
 *  persisted per teammate in localStorage, with at least one type always
 *  checked. `principalId` is already known on first render (it comes off the
 *  route context, not a fetch), so the initial state reads localStorage
 *  synchronously via a lazy initializer instead of hydrating in a mount effect. */
function useSourceFilter(principalId: string | undefined, visibleTypes: SourceType[]) {
  const [checked, setChecked] = useState<Set<SourceType>>(() => {
    if (principalId) {
      try {
        const raw = window.localStorage.getItem(copilotSourcesStorageKey(principalId))
        if (raw) {
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            const restored = new Set(
              parsed.filter((v): v is SourceType => visibleTypes.includes(v as SourceType))
            )
            if (restored.size > 0) return restored
          }
        }
      } catch {
        // Corrupt/unavailable storage — keep the default (all visible checked).
      }
    }
    return new Set(visibleTypes)
  })

  const toggle = useCallback(
    (type: SourceType) => {
      setChecked((prev) => {
        const next = new Set(prev)
        if (next.has(type)) {
          if (next.size === 1) return prev // at least one must remain checked
          next.delete(type)
        } else {
          next.add(type)
        }
        if (principalId) {
          try {
            window.localStorage.setItem(
              copilotSourcesStorageKey(principalId),
              JSON.stringify(Array.from(next))
            )
          } catch {
            // Storage may be unavailable (e.g. private browsing quota) — the
            // in-memory selection still applies for this session.
          }
        }
        return next
      })
    },
    [principalId]
  )

  return { checked, toggle }
}

function buildHistory(turns: CopilotTurn[]): CopilotHistoryEntry[] {
  const out: CopilotHistoryEntry[] = []
  for (const t of turns) {
    out.push({ role: 'teammate', content: t.question })
    if (t.status === 'done' && t.answer && !t.suppressed) {
      out.push({ role: 'copilot', content: t.answer })
    }
  }
  return out.slice(-MAX_HISTORY_ENTRIES)
}

export function CopilotPanel({
  conversationId,
  flags,
  onInsert,
}: {
  conversationId: ConversationId
  flags: FeatureFlags | undefined
  onInsert: (text: string, mode: InsertMode) => void
}) {
  const { principal } = useRouteContext({ from: '/admin' }) as { principal?: { id: string } | null }
  const { data: widgetConfig } = useQuery(settingsQueries.widgetConfig())
  const assistant = widgetConfig?.messenger?.assistant
  const assistantName = assistant?.name || 'Quinn'
  const headerLabel = assistantName !== 'Quinn' ? `${assistantName} Copilot` : 'Copilot'

  const sourceOptions = useMemo(() => visibleSourceOptions(flags), [flags])
  const visibleTypes = useMemo(() => sourceOptions.map((o) => o.type), [sourceOptions])
  const { checked, toggle } = useSourceFilter(principal?.id, visibleTypes)
  const sourceTypesParam = checked.size === visibleTypes.length ? undefined : Array.from(checked)

  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [input, setInput] = useState('')
  const [leakGateTurnId, setLeakGateTurnId] = useState<string | null>(null)
  const { start, stop } = useSseTurn()
  const nextIdRef = useRef(0)

  const busy = turns.some((t) => t.status === 'streaming')
  const leakGateTurn = turns.find((t) => t.id === leakGateTurnId) ?? null

  useEffect(() => stop, [stop])

  const runTurn = useCallback(
    async (id: string, question: string, history: CopilotHistoryEntry[]) => {
      const patch = (p: Partial<CopilotTurn>) =>
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)))

      let answer = ''
      let finished = false

      await start({
        url: '/api/admin/assistant/copilot',
        body: {
          conversationId,
          question,
          history,
          ...(sourceTypesParam ? { sourceTypes: sourceTypesParam } : {}),
        },
        handlers: {
          [COPILOT_EVENTS.delta]: (data) => {
            answer += (data as CopilotDeltaPayload).text
            patch({ answer, activity: null })
          },
          [COPILOT_EVENTS.activity]: (data) => {
            patch({ activity: (data as CopilotActivityPayload).status })
          },
          [COPILOT_EVENTS.final]: (data) => {
            const final = data as CopilotFinalPayload
            finished = true
            patch({
              answer: final.text || answer,
              citations: final.citations,
              internalSourced: final.internalSourced,
              suppressed: final.suppressed,
              status: 'done',
              activity: null,
            })
          },
          [COPILOT_EVENTS.error]: (data) => {
            const err = data as CopilotErrorPayload
            finished = true
            patch({ status: 'error', errorMessage: err.message })
          },
        },
        onHttpError: async (res) => {
          let message = GENERIC_ERROR
          try {
            const body = await res.json()
            if (body?.error?.message) message = body.error.message
          } catch {
            // Non-JSON error body — keep the generic message.
          }
          patch({ status: 'error', errorMessage: message })
        },
        onStreamEnd: () => {
          if (!finished) patch({ status: 'done', activity: null })
        },
        onAbort: () => {
          // Stopped intentionally — keep whatever streamed so far.
          patch({ status: 'done', activity: null })
        },
        onError: () => {
          patch({ status: 'error', errorMessage: GENERIC_ERROR })
        },
      })
    },
    [conversationId, sourceTypesParam, start]
  )

  const ask = useCallback(() => {
    const question = input.trim().slice(0, MAX_QUESTION_CHARS)
    if (!question || busy) return
    const history = buildHistory(turns)
    setInput('')
    const id = String(nextIdRef.current++)
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        answer: '',
        citations: [],
        internalSourced: false,
        status: 'streaming',
        activity: null,
      },
    ])
    void runTurn(id, question, history)
  }, [input, busy, turns, runTurn])

  const retry = useCallback(
    (id: string) => {
      if (busy) return
      const idx = turns.findIndex((t) => t.id === id)
      if (idx === -1) return
      const question = turns[idx].question
      const history = buildHistory(turns.slice(0, idx))
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                answer: '',
                citations: [],
                internalSourced: false,
                suppressed: undefined,
                errorMessage: undefined,
                status: 'streaming' as const,
                activity: null,
              }
            : t
        )
      )
      void runTurn(id, question, history)
    },
    [turns, busy, runTurn]
  )

  const newChat = useCallback(() => {
    if (busy) return
    setTurns([])
    setInput('')
  }, [busy])

  const handleAddToComposer = useCallback(
    (turn: CopilotTurn) => {
      if (turn.internalSourced) {
        setLeakGateTurnId(turn.id)
      } else {
        onInsert(turn.answer, 'reply')
      }
    },
    [onInsert]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Avatar src={assistant?.avatarUrl} name={assistantName} className="size-6 text-[10px]" />
          <span className="text-sm font-medium">{headerLabel}</span>
        </div>
        <button
          type="button"
          onClick={newChat}
          disabled={busy}
          aria-label="New chat"
          title="New chat"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <CopilotEmptyState />
        ) : (
          <div className="space-y-4">
            {turns.map((turn) => (
              <CopilotTurnView
                key={turn.id}
                turn={turn}
                onAddToComposer={() => handleAddToComposer(turn)}
                onAddAsNote={() => onInsert(turn.answer, 'note')}
                onRetry={() => retry(turn.id)}
              />
            ))}
          </div>
        )}
      </div>

      <CopilotAskInput
        value={input}
        onChange={setInput}
        onSubmit={ask}
        onStop={stop}
        busy={busy}
        hasAskedBefore={turns.length > 0}
        sourceOptions={sourceOptions}
        checked={checked}
        onToggleSource={toggle}
      />

      <AlertDialog open={!!leakGateTurn} onOpenChange={(open) => !open && setLeakGateTurnId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This answer uses internal sources</AlertDialogTitle>
            <AlertDialogDescription>
              It cites content your customers are not meant to see. Review before sending, or add it
              as an internal note instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setLeakGateTurnId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (leakGateTurn) onInsert(leakGateTurn.answer, 'note')
                setLeakGateTurnId(null)
              }}
            >
              Add as note
            </Button>
            <Button
              type="button"
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (leakGateTurn) onInsert(leakGateTurn.answer, 'reply')
                setLeakGateTurnId(null)
              }}
            >
              Add to composer anyway
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CopilotEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-2 py-6 text-center">
      <SparklesIcon className="h-8 w-8 text-primary/60" />
      <p className="text-sm font-medium text-foreground">
        Ask Quinn anything about this conversation.
      </p>
      <ul className="w-full space-y-2.5 text-left text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <MagnifyingGlassIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Finds answers from your help center, snippets, roadmap posts, and this customer&apos;s
            past conversations.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <BoltIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Suggests what to do next using your team&apos;s internal knowledge.</span>
        </li>
        <li className="flex items-start gap-2">
          <LockClosedIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Copilot chats are private to you.</span>
        </li>
      </ul>
    </div>
  )
}

function CopilotTurnView({
  turn,
  onAddToComposer,
  onAddAsNote,
  onRetry,
}: {
  turn: CopilotTurn
  onAddToComposer: () => void
  onAddAsNote: () => void
  onRetry: () => void
}) {
  const streaming = turn.status === 'streaming'
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          {turn.question}
        </div>
      </div>
      <div className="rounded-lg bg-muted/60 p-3">
        {turn.activity && <AssistantWorkingTrace status={turn.activity} />}
        {turn.status === 'error' ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{turn.errorMessage ?? GENERIC_ERROR}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : turn.suppressed ? (
          <p className="text-sm text-muted-foreground">
            I could not find enough to answer that. Try rephrasing, or check the sources filter.
          </p>
        ) : (
          <>
            <AssistantAnswer text={turn.answer} citations={turn.citations} caret={streaming} />
            {!streaming && turn.answer && (
              <div className="mt-2 flex items-center gap-1.5">
                <Button type="button" size="sm" onClick={onAddToComposer} disabled={streaming}>
                  Add to composer
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More answer actions"
                      disabled={streaming}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <EllipsisHorizontalIcon className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onAddAsNote}>Add as note</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
      </div>
      {!streaming && turn.citations.length > 0 && <CopilotSourcesList citations={turn.citations} />}
    </div>
  )
}

function CopilotSourcesList({ citations }: { citations: CopilotCitation[] }) {
  return (
    <div className="ps-1">
      <p className="mb-1 text-[11px] text-muted-foreground/70">
        {citations.length} relevant {citations.length === 1 ? 'source' : 'sources'}
      </p>
      <div className="flex flex-col gap-0.5">
        {citations.map((c) => (
          <CopilotSourceRow key={c.id} citation={c} />
        ))}
      </div>
    </div>
  )
}

function CopilotSourceRow({ citation }: { citation: CopilotCitation }) {
  const meta = SOURCE_TYPE_META[citation.type]
  const Icon = meta.icon
  const isInternal = citation.internal === true
  const hasUrl = !!citation.url
  const [copied, setCopied] = useState(false)

  const copyLink = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!citation.url) return
    void navigator.clipboard?.writeText(citation.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const row = (
    <span className="group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', isInternal && 'text-amber-600')} />
      <span className="truncate">{citation.title}</span>
      {isInternal && <LockClosedIcon className="h-3 w-3 shrink-0 text-amber-600" />}
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-30 w-60 -translate-y-1 rounded-xl border border-border bg-popover p-3 text-left opacity-0 shadow-xl transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <span className="mb-1 block text-[13px] font-semibold leading-snug text-foreground">
          {citation.title}
        </span>
        <span className="mb-1 block text-[11px] text-muted-foreground">
          {meta.label}
          {isInternal ? ' · Internal' : ''}
        </span>
        {hasUrl ? (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">{citation.url}</span>
            <button
              type="button"
              onClick={copyLink}
              className="pointer-events-auto shrink-0 text-[11px] text-primary hover:underline"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            Internal · not linkable
          </span>
        )}
      </span>
    </span>
  )

  return hasUrl ? (
    <a href={citation.url} target="_blank" rel="noreferrer" className="no-underline">
      {row}
    </a>
  ) : (
    row
  )
}

function CopilotAskInput({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  hasAskedBefore,
  sourceOptions,
  checked,
  onToggleSource,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  hasAskedBefore: boolean
  sourceOptions: SourceOption[]
  checked: Set<SourceType>
  onToggleSource: (type: SourceType) => void
}) {
  const placeholder = hasAskedBefore ? 'Ask a follow-up question...' : 'Ask a question...'
  return (
    <div className="border-t border-border/50 p-3">
      <div className="relative rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary/20">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          disabled={busy}
          className="resize-none border-0 pe-16 shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
        <div className="absolute bottom-1.5 end-1.5 flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Answer sources"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FunnelIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-1 p-2">
              <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Answer sources</p>
              {sourceOptions.map((opt) => {
                const Icon = opt.icon
                return (
                  <label
                    key={opt.type}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked.has(opt.type)}
                      onCheckedChange={() => onToggleSource(opt.type)}
                      className="mt-0.5"
                    />
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex flex-col">
                      <span className="text-sm">{opt.label}</span>
                      {opt.subtitle && (
                        <span className="text-[11px] text-muted-foreground">{opt.subtitle}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={busy ? onStop : onSubmit}
            disabled={!busy && !value.trim()}
            aria-label={busy ? 'Stop' : 'Ask'}
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-primary-foreground transition-colors disabled:opacity-40',
              busy ? 'bg-destructive' : 'bg-primary'
            )}
          >
            {busy ? (
              <StopIcon className="h-3.5 w-3.5" />
            ) : (
              <PaperAirplaneIcon className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
