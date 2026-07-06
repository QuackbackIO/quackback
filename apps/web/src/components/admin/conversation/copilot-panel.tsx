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
import { toast } from 'sonner'
import {
  ArrowPathIcon,
  BoltIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentListIcon,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  TRANSFORM_EVENTS,
  type CopilotActivityPayload,
  type CopilotCitation,
  type CopilotDeltaPayload,
  type CopilotErrorPayload,
  type CopilotFinalPayload,
  type CopilotHistoryEntry,
  type TransformKind,
  type TransformDeltaPayload,
  type TransformFinalPayload,
  type TransformErrorPayload,
} from '@/lib/shared/assistant/copilot-contract'
import {
  stripCitationMarkers,
  formatConversationSummaryNote,
} from '@/lib/shared/assistant/copilot-format'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import { saveCopilotAnswerAsMacroFn } from '@/lib/server/functions/macros'
import { summarizeConversationNowFn } from '@/lib/server/functions/copilot-summary'

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_ENTRIES = 20
const GENERIC_ERROR = 'Something went wrong. Try again.'

type SourceType = CopilotCitation['type']
type InsertMode = 'reply' | 'note'

/** The answer card's "Add to composer & modify" menu rows (P2-C.1): the tone
 *  transforms Fin ships in its equivalent menu. */
const MODIFY_ROWS: { transform: TransformKind; label: string }[] = [
  { transform: 'my_tone', label: 'My tone of voice' },
  { transform: 'more_friendly', label: 'More friendly' },
  { transform: 'more_formal', label: 'More formal' },
  { transform: 'more_concise', label: 'More concise' },
]

/** The reply composer's Format chip menu rows (P2-C.1): acts on the
 *  composer's own draft rather than an answer. */
const FORMAT_ROWS: { transform: TransformKind; label: string }[] = [
  { transform: 'expand', label: 'Expand' },
  { transform: 'rephrase', label: 'Rephrase' },
  { transform: 'more_friendly', label: 'More friendly' },
  { transform: 'more_formal', label: 'More formal' },
  { transform: 'more_concise', label: 'More concise' },
  { transform: 'fix_grammar', label: 'Fix grammar and spelling' },
]

/** Which control currently owns the in-flight transform stream: used to show
 *  its own inline progress state and disable every OTHER transform entry
 *  point until it settles (only one transform runs at a time). */
type TransformState = { scope: 'answer'; turnId: string } | { scope: 'composer' }

/** An answer (or a transform of one) awaiting the internal-source leak-gate
 *  confirm: carries the text to actually insert, since a modify transform's
 *  result differs from the turn's original `answer`. */
interface PendingInsert {
  text: string
}

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
  getComposerText,
  onReplaceComposerText,
}: {
  conversationId: ConversationId
  flags: FeatureFlags | undefined
  onInsert: (text: string, mode: InsertMode) => void
  /** Current plain text of the reply composer: the Format chip's
   *  empty-check and its transform source (P2-C.1). */
  getComposerText: () => string
  /** Replace the reply composer's content with a Format transform's result. */
  onReplaceComposerText: (text: string) => void
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
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null)
  const [saveMacroTurnId, setSaveMacroTurnId] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const { start, stop } = useSseTurn()
  // A transform (modify-answer or Format) runs on its own SSE turn, separate
  // from the ask/answer stream above, so asking a follow-up and transforming
  // a prior answer never abort each other.
  const { start: startTransform, stop: stopTransform } = useSseTurn()
  const [transformState, setTransformState] = useState<TransformState | null>(null)
  const transforming = transformState !== null
  const nextIdRef = useRef(0)

  const busy = turns.some((t) => t.status === 'streaming')
  const saveMacroTurn = turns.find((t) => t.id === saveMacroTurnId) ?? null
  // Pull-based read (mirrors insertMacroBody): re-read on every render rather
  // than threading composer text through props on every keystroke, which
  // would re-render this whole panel (and the virtualized thread above it)
  // on every character typed.
  const composerEmpty = getComposerText().trim().length === 0

  useEffect(() => stop, [stop])
  useEffect(() => stopTransform, [stopTransform])

  // Route an answer (or a transform of one) to the insert callback, gating on
  // the leak-gate confirm when the SOURCE answer was internal-sourced:
  // transforming text never launders it, so a modify result inherits the
  // originating turn's `internalSourced` flag rather than re-deriving one.
  const requestInsert = useCallback(
    (text: string, internalSourced: boolean) => {
      if (internalSourced) setPendingInsert({ text })
      else onInsert(text, 'reply')
    },
    [onInsert]
  )

  const runTransform = useCallback(
    async (transform: TransformKind, text: string): Promise<string | null> => {
      let result = ''
      let ok = true
      await startTransform({
        url: '/api/admin/assistant/transform',
        body: { conversationId, text, transform },
        handlers: {
          [TRANSFORM_EVENTS.delta]: (data) => {
            result += (data as TransformDeltaPayload).text
          },
          [TRANSFORM_EVENTS.final]: (data) => {
            const final = data as TransformFinalPayload
            if (final.text) result = final.text
          },
          [TRANSFORM_EVENTS.error]: (data) => {
            ok = false
            toast.error((data as TransformErrorPayload).message || GENERIC_ERROR)
          },
        },
        onHttpError: async (res) => {
          ok = false
          let message = GENERIC_ERROR
          try {
            const body = await res.json()
            if (body?.error?.message) message = body.error.message
          } catch {
            // Non-JSON error body: keep the generic message.
          }
          toast.error(message)
        },
        onAbort: () => {
          ok = false
        },
        onError: () => {
          ok = false
          toast.error(GENERIC_ERROR)
        },
      })
      return ok && result ? result : null
    },
    [conversationId, startTransform]
  )

  const modifyAnswer = useCallback(
    async (turn: CopilotTurn, transform: TransformKind) => {
      if (transforming || !turn.answer) return
      setTransformState({ scope: 'answer', turnId: turn.id })
      try {
        const result = await runTransform(transform, turn.answer)
        if (result) requestInsert(result, turn.internalSourced)
      } finally {
        setTransformState(null)
      }
    },
    [transforming, runTransform, requestInsert]
  )

  const formatComposer = useCallback(
    async (transform: TransformKind) => {
      const text = getComposerText()
      if (transforming || !text.trim()) return
      setTransformState({ scope: 'composer' })
      try {
        const result = await runTransform(transform, text)
        if (result) onReplaceComposerText(result)
      } finally {
        setTransformState(null)
      }
    },
    [transforming, runTransform, getComposerText, onReplaceComposerText]
  )

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
    (turn: CopilotTurn) => requestInsert(turn.answer, turn.internalSourced),
    [requestInsert]
  )

  const summarizeNow = useCallback(async () => {
    if (busy || summarizing) return
    setSummarizing(true)
    try {
      const result = await summarizeConversationNowFn({ data: { conversationId } })
      onInsert(formatConversationSummaryNote(result.question, result.bullets), 'note')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to summarize the conversation')
    } finally {
      setSummarizing(false)
    }
  }, [busy, summarizing, conversationId, onInsert])

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
                onSaveAsMacro={() => setSaveMacroTurnId(turn.id)}
                onRetry={() => retry(turn.id)}
                onModify={(transform) => void modifyAnswer(turn, transform)}
                transformBusy={transforming}
                isTransforming={
                  transformState?.scope === 'answer' && transformState.turnId === turn.id
                }
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
        onSummarize={() => void summarizeNow()}
        summarizing={summarizing}
        onFormat={(transform) => void formatComposer(transform)}
        formatDisabled={busy || transforming || composerEmpty}
        formatBusy={transformState?.scope === 'composer'}
        composerEmpty={composerEmpty}
      />

      <SaveAsMacroDialog
        turn={saveMacroTurn}
        onOpenChange={(open) => !open && setSaveMacroTurnId(null)}
      />

      <AlertDialog open={!!pendingInsert} onOpenChange={(open) => !open && setPendingInsert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This answer uses internal sources</AlertDialogTitle>
            <AlertDialogDescription>
              It cites content your customers are not meant to see. Review before sending, or add it
              as an internal note instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingInsert(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (pendingInsert) onInsert(pendingInsert.text, 'note')
                setPendingInsert(null)
              }}
            >
              Add as note
            </Button>
            <Button
              type="button"
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (pendingInsert) onInsert(pendingInsert.text, 'reply')
                setPendingInsert(null)
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
  onSaveAsMacro,
  onRetry,
  onModify,
  transformBusy,
  isTransforming,
}: {
  turn: CopilotTurn
  onAddToComposer: () => void
  onAddAsNote: () => void
  onSaveAsMacro: () => void
  onRetry: () => void
  /** Run a modify transform on this turn's answer (P2-C.1). */
  onModify: (transform: TransformKind) => void
  /** Any transform (this turn's or another's) is in flight: disables this
   *  card's own entry points too, so only one transform runs at a time. */
  transformBusy: boolean
  /** This specific turn's answer is the one being transformed right now. */
  isTransforming: boolean
}) {
  const streaming = turn.status === 'streaming'
  const actionsDisabled = streaming || transformBusy
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
                <Button
                  type="button"
                  size="sm"
                  onClick={onAddToComposer}
                  disabled={actionsDisabled}
                >
                  Add to composer
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More answer actions"
                      disabled={actionsDisabled}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <EllipsisHorizontalIcon className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Add to composer & modify</DropdownMenuLabel>
                    {MODIFY_ROWS.map((row) => (
                      <DropdownMenuItem key={row.transform} onClick={() => onModify(row.transform)}>
                        <SparklesIcon className="h-3.5 w-3.5" />
                        {row.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onAddAsNote}>Add as note</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onSaveAsMacro}>Save as macro</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {isTransforming && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                    Rewriting…
                  </span>
                )}
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
  onSummarize,
  summarizing,
  onFormat,
  formatDisabled,
  formatBusy,
  composerEmpty,
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
  /** Chips row above the input (COPILOT-SIDEBAR-UX.md P2-C): [Format] acts on
   *  the reply composer's own draft; [Summarize] writes a note. */
  onSummarize: () => void
  summarizing: boolean
  /** Run a Format transform on the reply composer's current draft. */
  onFormat: (transform: TransformKind) => void
  /** Disabled while busy/transforming, or while the composer has no draft. */
  formatDisabled: boolean
  /** This chip's own transform is the one in flight right now. */
  formatBusy: boolean
  /** Whether the disabled state above is specifically "no draft yet": drives
   *  the "Write a draft first" tooltip rather than a generic disabled state. */
  composerEmpty: boolean
}) {
  const placeholder = hasAskedBefore ? 'Ask a follow-up question...' : 'Ask a question...'
  return (
    <div className="border-t border-border/50 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={formatDisabled}
              title={composerEmpty ? 'Write a draft first' : undefined}
              className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {formatBusy ? (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SparklesIcon className="h-3.5 w-3.5" />
              )}
              {formatBusy ? 'Formatting…' : 'Format'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {FORMAT_ROWS.map((row) => (
              <DropdownMenuItem key={row.transform} onClick={() => onFormat(row.transform)}>
                {row.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={onSummarize}
          disabled={busy || summarizing}
          className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          {summarizing ? (
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ClipboardDocumentListIcon className="h-3.5 w-3.5" />
          )}
          {summarizing ? 'Summarizing…' : 'Summarize'}
        </button>
      </div>
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

/** First few words of a question, used to prefill the macro name field. */
function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ')
}

/** The answer card "..." menu's "Save as macro" dialog (P2-C.2). Keyed on the
 *  turn's id so switching to a different turn's dialog remounts the form with
 *  a fresh name/body instead of carrying over stale edits. */
function SaveAsMacroDialog({
  turn,
  onOpenChange,
}: {
  turn: CopilotTurn | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!turn} onOpenChange={onOpenChange}>
      <DialogContent>
        {turn && <SaveAsMacroForm key={turn.id} turn={turn} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SaveAsMacroForm({ turn, onClose }: { turn: CopilotTurn; onClose: () => void }) {
  const [name, setName] = useState(() => firstWords(turn.question, 6))
  const [saving, setSaving] = useState(false)
  const body = useMemo(() => stripCitationMarkers(turn.answer), [turn.answer])

  const save = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName || saving) return
    setSaving(true)
    try {
      await saveCopilotAnswerAsMacroFn({ data: { name: trimmedName, body } })
      toast.success('Macro saved')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save macro')
    } finally {
      setSaving(false)
    }
  }, [name, body, saving, onClose])

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as macro</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="copilot-macro-name">Name</Label>
          <Input
            id="copilot-macro-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="copilot-macro-body">Body</Label>
          <Textarea
            id="copilot-macro-body"
            value={body}
            readOnly
            rows={6}
            className="max-h-40 resize-none overflow-y-auto"
          />
        </div>
        {turn.internalSourced && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This answer used internal sources. Review before saving it as a reusable reply.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
