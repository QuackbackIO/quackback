/**
 * Quinn Copilot: a private, teammate-facing Q&A thread scoped to a single
 * conversation OR ticket (COPILOT-SIDEBAR-UX.md; item-scoped per unified
 * inbox §2.9). Renders inside the unified inbox detail panel's "Copilot" tab
 * (inbox-detail-panel.tsx). Streams against POST /api/admin/assistant/copilot
 * (copilot.v1.* SSE events, cloned from the admin assistant sandbox's
 * fetch/SSE/patch-last-turn shape), reuses AssistantAnswer for citation
 * rendering, and gates any internal-sourced answer behind a hard confirm
 * before it can reach a customer-facing composer (B.4's leak gate) — "Add as
 * note" never confirms, from anywhere.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowPathIcon,
  BoltIcon,
  ClipboardDocumentListIcon,
  EllipsisHorizontalIcon,
  FunnelIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  HandThumbDownIcon as HandThumbDownSolidIcon,
  HandThumbUpIcon as HandThumbUpSolidIcon,
  PaperAirplaneIcon,
  StopIcon,
} from '@heroicons/react/24/solid'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  AssistantAnswer,
  AssistantWorkingTrace,
} from '@/components/shared/conversation/assistant-turn'
import { CopilotProposedActionCard } from './copilot-proposed-action-card'
import { SaveAsMacroDialog } from './copilot-save-as-macro-dialog'
import {
  CopilotSourcesList,
  visibleSourceOptions,
  type SourceOption,
  type SourceType,
} from './copilot-sources'
import { useSseTurn } from '@/lib/client/hooks/use-sse-turn'
import { settingsQueries } from '@/lib/client/queries/settings'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  COPILOT_EVENTS,
  TRANSFORM_EVENTS,
  type CopilotActivityPayload,
  type CopilotAnswerType,
  type CopilotCitation,
  type CopilotDeltaPayload,
  type CopilotErrorPayload,
  type CopilotFinalPayload,
  type CopilotHistoryEntry,
  type CopilotProposedAction,
  type TransformKind,
  type TransformDeltaPayload,
  type TransformFinalPayload,
  type TransformErrorPayload,
} from '@/lib/shared/assistant/copilot-contract'
import { formatConversationSummaryNote } from '@/lib/shared/assistant/copilot-format'
import { recordCopilotEvent, type CopilotEventInput } from '@/lib/client/copilot-events'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import type { InboxItemRef } from '@/lib/shared/inbox/items'
import {
  summarizeConversationNowFn,
  summarizeTicketNowFn,
} from '@/lib/server/functions/copilot-summary'

/** The item-ref body fragment every Copilot SSE request carries (unified
 *  inbox §2.9's `withAssistantItemRef` union) — `{ conversationId }` or
 *  `{ ticketId }`, exactly one, spread alongside the route's own fields. */
function itemRefBody(item: InboxItemRef): { conversationId: string } | { ticketId: string } {
  return item.kind === 'conversation' ? { conversationId: item.id } : { ticketId: item.id }
}

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_ENTRIES = 20
const GENERIC_ERROR = 'Something went wrong. Try again.'

/**
 * Panel-scoped bindings, surfaced in the inbox shortcut help panel. These are
 * NOT bound by use-inbox-keyboard — the panel's own keydown handler owns them
 * (they only fire while focus is inside the Copilot panel), so they live here
 * next to that handler rather than in the inbox action registry.
 */
export const COPILOT_PANEL_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘↵', label: 'Insert last Copilot answer (with the ask box empty)' },
]

/** Pull the server's `{error:{message}}` body off a failed SSE turn's HTTP
 *  response, falling back to GENERIC_ERROR for a non-JSON (or empty) body.
 *  Shared by both `onHttpError` handlers below (the ask/answer turn and the
 *  transform turn) so the same fallback logic doesn't drift between them. */
async function extractHttpErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error?.message) return body.error.message as string
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return GENERIC_ERROR
}

type InsertMode = 'reply' | 'note'

/** The answer card's "Add to composer & modify" menu rows (P2-C.1): the tone
 *  transforms offered before inserting an answer into the composer. */
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

/** The usage event to record once an insert actually happens — carried
 *  alongside the text so the leak-gate confirm logs on proceed, never on the
 *  initial (possibly cancelled) click. Names the GESTURE kind (what was
 *  inserted); WHERE it lands is the destination axis performInsert adds from
 *  its own `mode`. `internalSourced` doubles as the leak-gate flag itself
 *  (requestInsert gates on it); it is absent on an unfinalized turn's events
 *  (no final frame ever carried the server-derived signal). */
type InsertEventMeta = Pick<CopilotEventInput, 'eventType' | 'answerType' | 'internalSourced'>

/** An answer (or a transform of one) awaiting the internal-source leak-gate
 *  confirm: carries the text to actually insert, since a modify transform's
 *  result differs from the turn's original `answer`. */
interface PendingInsert {
  text: string
  event: InsertEventMeta
}

export interface CopilotTurn {
  id: string
  question: string
  answer: string
  /** Whether the answer is a customer-facing reply draft or internal analysis
   *  (drives which action is primary in CopilotTurnView). Defaults to
   *  `draft_reply` while streaming and until the final payload sets it. */
  answerType: CopilotAnswerType
  citations: CopilotCitation[]
  internalSourced: boolean
  /** True only once the final SSE frame landed. `internalSourced`/`answerType`
   *  arrive ON that frame, so an aborted or truncated turn still holds their
   *  ask-time defaults — every consumer that would route text toward the
   *  customer-facing composer must fail closed (note-only) until this is set. */
  finalized: boolean
  suppressed?: string
  /** Write-tool calls this turn proposed (P2-C.4, act-on-approval); empty
   *  unless the model called a write tool, since every write tool proposes
   *  rather than executes on this surface. */
  proposedActions: CopilotProposedAction[]
  status: 'streaming' | 'done' | 'error'
  activity: AssistantActivityStatus | null
  errorMessage?: string
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

/** The turn-scoped qualifiers every usage event carries. `internalSourced` is
 *  omitted (not asserted `false`) on an unfinalized turn — the final frame
 *  that carries the server-derived signal never arrived. */
function turnMeta(turn: CopilotTurn): Pick<CopilotEventInput, 'answerType' | 'internalSourced'> {
  return {
    answerType: turn.answerType,
    ...(turn.finalized ? { internalSourced: turn.internalSourced } : {}),
  }
}

export function CopilotPanel({
  item,
  flags,
  onInsert,
  getComposerText,
  onReplaceComposerText,
  askInputRef,
}: {
  /** The open item (unified inbox §2.9) — grounds the turn on the
   *  conversation or ticket's own thread + drives the Summarize chip. */
  item: InboxItemRef
  flags: FeatureFlags | undefined
  onInsert: (text: string, mode: InsertMode) => void
  /** Current plain text of the reply composer: the Format chip's
   *  empty-check and its transform source (P2-C.1). */
  getComposerText: () => string
  /** Replace the reply composer's content with a Format transform's result. */
  onReplaceComposerText: (text: string) => void
  /** The ask textarea's DOM node, for hosts that focus it from outside
   *  (e.g. an inbox keyboard shortcut). */
  askInputRef?: Ref<HTMLTextAreaElement>
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

  // Fire-and-forget usage logging (inserts + thumbs feedback). recordCopilotEvent
  // swallows every failure, so a logging hiccup can never affect the insert.
  const logEvent = useCallback(
    (event: Omit<CopilotEventInput, 'item'>) =>
      recordCopilotEvent({ item: itemRefBody(item), ...event }),
    [item]
  )

  // The single insert seam: route text into the host composer AND record the
  // matching usage event, so the two can never be paired inconsistently
  // across call sites. The event keeps its gesture kind (answer / transform /
  // summary); WHERE it landed is the orthogonal `destination` axis, filled in
  // here from the insert mode itself so the two can never disagree.
  const performInsert = useCallback(
    (text: string, mode: InsertMode, event: InsertEventMeta) => {
      onInsert(text, mode)
      logEvent({ ...event, destination: mode })
    },
    [onInsert, logEvent]
  )

  // Route an answer (or a transform of one) toward the reply composer, gating
  // on the leak-gate confirm when the SOURCE answer was internal-sourced (the
  // event meta carries that flag): transforming text never launders it, so a
  // modify result inherits the originating turn's `internalSourced` rather
  // than re-deriving one.
  const requestInsert = useCallback(
    (text: string, event: InsertEventMeta) => {
      if (event.internalSourced) {
        setPendingInsert({ text, event })
      } else {
        performInsert(text, 'reply', event)
      }
    },
    [performInsert]
  )

  const runTransform = useCallback(
    async (transform: TransformKind, text: string): Promise<string | null> => {
      let result = ''
      let ok = true
      await startTransform({
        url: '/api/admin/assistant/transform',
        body: { ...itemRefBody(item), text, transform },
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
          toast.error(await extractHttpErrorMessage(res))
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
    [item, startTransform]
  )

  const modifyAnswer = useCallback(
    async (turn: CopilotTurn, transform: TransformKind) => {
      if (transforming || !turn.answer) return
      setTransformState({ scope: 'answer', turnId: turn.id })
      try {
        const result = await runTransform(transform, turn.answer)
        if (result) {
          requestInsert(result, { eventType: 'transform_inserted', ...turnMeta(turn) })
        }
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
          ...itemRefBody(item),
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
            // The ONLY place `finalized` flips true: the flags below are
            // trustworthy exactly when this frame arrived.
            patch({
              answer: final.text || answer,
              answerType: final.answerType,
              citations: final.citations,
              internalSourced: final.internalSourced,
              finalized: true,
              suppressed: final.suppressed,
              proposedActions: final.proposedActions ?? [],
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
          patch({ status: 'error', errorMessage: await extractHttpErrorMessage(res) })
        },
        onStreamEnd: () => {
          // Ended without a final frame: the turn stays unfinalized, so the
          // card falls back to the note-only affordance (see CopilotTurnView).
          if (!finished) patch({ status: 'done', activity: null })
        },
        onAbort: () => {
          // Stopped intentionally — keep whatever streamed so far, but the
          // turn is NOT finalized: no final frame means no trustworthy
          // internalSourced/answerType, so no customer-facing insert.
          patch({ status: 'done', activity: null })
        },
        onError: () => {
          patch({ status: 'error', errorMessage: GENERIC_ERROR })
        },
      })
    },
    [item, sourceTypesParam, start]
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
        answerType: 'draft_reply',
        citations: [],
        internalSourced: false,
        finalized: false,
        proposedActions: [],
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
                answerType: 'draft_reply' as const,
                citations: [],
                internalSourced: false,
                finalized: false,
                suppressed: undefined,
                proposedActions: [],
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
    (turn: CopilotTurn) =>
      requestInsert(turn.answer, { eventType: 'answer_inserted', ...turnMeta(turn) }),
    [requestInsert]
  )

  // Never leak-gated ("Add as note" never confirms, from anywhere);
  // performInsert records the answer_inserted gesture with destination 'note'.
  const handleAddAsNote = useCallback(
    (turn: CopilotTurn) =>
      performInsert(turn.answer, 'note', { eventType: 'answer_inserted', ...turnMeta(turn) }),
    [performInsert]
  )

  // Cmd/Ctrl+Enter anywhere inside the panel (COPILOT_PANEL_SHORTCUTS):
  // trigger the LAST completed answer's primary action — the same handlers
  // the buttons call, so the leak-gate confirm and usage logging apply
  // unchanged. The panel's dialogs (leak gate, save-as-macro) render in
  // portals outside this subtree, so their keydowns never reach this handler.
  const insertLastAnswer = useCallback(() => {
    if (busy || transforming) return // mirrors the buttons' disabled state
    const last = turns.findLast((t) => t.status === 'done' && !!t.answer && !t.suppressed)
    if (!last) return
    // An unfinalized (aborted/truncated) turn fails closed alongside analysis
    // answers: note-only, matching the card's own affordances.
    if (!last.finalized || last.answerType === 'analysis') handleAddAsNote(last)
    else handleAddToComposer(last)
  }, [busy, transforming, turns, handleAddAsNote, handleAddToComposer])

  const onPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        insertLastAnswer()
      }
    },
    [insertLastAnswer]
  )

  const summarizeNow = useCallback(async () => {
    if (busy || summarizing) return
    setSummarizing(true)
    try {
      const result =
        item.kind === 'conversation'
          ? await summarizeConversationNowFn({ data: { conversationId: item.id } })
          : await summarizeTicketNowFn({ data: { ticketId: item.id } })
      performInsert(formatConversationSummaryNote(result.question, result.bullets), 'note', {
        eventType: 'summary_inserted',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to summarize the conversation')
    } finally {
      setSummarizing(false)
    }
  }, [busy, summarizing, item, performInsert])

  return (
    // Bubble-phase only: fires for keydowns on the panel's own focusable
    // children (ask input, answer buttons), never globally.
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onPanelKeyDown}>
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
          <CopilotEmptyState assistantName={assistantName} />
        ) : (
          <div className="space-y-4">
            {turns.map((turn) => (
              <CopilotTurnView
                key={turn.id}
                turn={turn}
                onAddToComposer={() => handleAddToComposer(turn)}
                onAddAsNote={() => handleAddAsNote(turn)}
                onSaveAsMacro={() => setSaveMacroTurnId(turn.id)}
                onRetry={() => retry(turn.id)}
                onModify={(transform) => void modifyAnswer(turn, transform)}
                onFeedback={(rating, reason) =>
                  logEvent({
                    eventType: 'feedback',
                    rating,
                    ...(reason ? { reason } : {}),
                    ...turnMeta(turn),
                  })
                }
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
        inputRef={askInputRef}
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
                if (pendingInsert) performInsert(pendingInsert.text, 'note', pendingInsert.event)
                setPendingInsert(null)
              }}
            >
              Add as note
            </Button>
            <Button
              type="button"
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (pendingInsert) performInsert(pendingInsert.text, 'reply', pendingInsert.event)
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

function CopilotEmptyState({ assistantName }: { assistantName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-2 py-6 text-center">
      <SparklesIcon className="h-8 w-8 text-primary/60" />
      <p className="text-sm font-medium text-foreground">
        Ask {assistantName} anything about this conversation.
      </p>
      <ul className="w-full space-y-2.5 text-left text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <MagnifyingGlassIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Reads this conversation, then finds answers in your help center, snippets, roadmap
            posts, and this customer&apos;s past conversations.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <BoltIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Suggests what to do next using your team&apos;s internal knowledge.</span>
        </li>
        <li className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Can take actions for you, with your approval.</span>
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
  onFeedback,
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
  /** Record a thumbs rating (and an optional thumbs-down reason) for this
   *  turn's answer. Fire-and-forget — the latch below is purely local. */
  onFeedback: (rating: 'up' | 'down', reason?: string) => void
  /** Any transform (this turn's or another's) is in flight: disables this
   *  card's own entry points too, so only one transform runs at a time. */
  transformBusy: boolean
  /** This specific turn's answer is the one being transformed right now. */
  isTransforming: boolean
}) {
  const streaming = turn.status === 'streaming'
  const actionsDisabled = streaming || transformBusy
  // Analysis answers (guidance/reasoning about the conversation, not a reply to
  // send) promote "Add as note" to the primary action and demote "Add to
  // composer" into the overflow menu — inserting internal analysis into a
  // customer-facing reply is the exact mismatch answerType exists to fix. A
  // draft_reply answer (and every un-classified one, which defaults to it)
  // keeps the historical layout: "Add to composer" primary.
  const isAnalysis = turn.answerType === 'analysis'
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
            {!streaming && turn.answer && !turn.finalized && (
              // Aborted/truncated turn: the final frame carrying the
              // server-derived internalSourced/answerType never arrived, so
              // there is nothing to gate a customer-facing insert on — fail
              // closed to the one affordance that never needs the gate.
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" onClick={onAddAsNote} disabled={actionsDisabled}>
                  Add as note
                </Button>
                <CopilotTurnFeedback onFeedback={onFeedback} />
              </div>
            )}
            {!streaming && turn.answer && turn.finalized && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  onClick={isAnalysis ? onAddAsNote : onAddToComposer}
                  disabled={actionsDisabled}
                >
                  {isAnalysis ? 'Add as note' : 'Add to composer'}
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
                    {isAnalysis ? (
                      // The tone-rewrite rows are all about polishing a
                      // customer reply, so they'd be noise on an analysis
                      // answer; the menu here is just the demoted composer
                      // escape hatch plus the shared "save as macro".
                      <DropdownMenuItem onClick={onAddToComposer}>Add to composer</DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuLabel>Add to composer & modify</DropdownMenuLabel>
                        {MODIFY_ROWS.map((row) => (
                          <DropdownMenuItem
                            key={row.transform}
                            onClick={() => onModify(row.transform)}
                          >
                            <SparklesIcon className="h-3.5 w-3.5" />
                            {row.label}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onAddAsNote}>Add as note</DropdownMenuItem>
                      </>
                    )}
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
                <CopilotTurnFeedback onFeedback={onFeedback} />
              </div>
            )}
          </>
        )}
      </div>
      {!streaming &&
        turn.proposedActions.map((action) => (
          <CopilotProposedActionCard key={action.id} action={action} />
        ))}
      {!streaming && turn.citations.length > 0 && <CopilotSourcesList citations={turn.citations} />}
    </div>
  )
}

/** Compact thumbs up/down at a completed answer's footer: single-select,
 *  latched once chosen but switchable, with an optional one-line reason input
 *  on thumbs-down. The latch is per-turn component state only (no persistence
 *  across reloads). Thumbs-up reports through `onFeedback` immediately;
 *  thumbs-down reports once when its reason input resolves (see `choose`).
 *  Rendered inside the actions row (which flex-wraps), so the thumbs sit
 *  right-aligned on the row and the reason input drops to its own full-width
 *  line. */
function CopilotTurnFeedback({
  onFeedback,
}: {
  onFeedback: (rating: 'up' | 'down', reason?: string) => void
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')

  // A thumbs-down logs exactly ONCE, when its reason input resolves: Send
  // logs it WITH the reason, the X dismiss logs it without one. Logging on
  // the initial click too would double-count every reasoned downvote.
  // Thumbs-up has no reason step, so it logs immediately — and switching to
  // it while a downvote's input is open discards that pending downvote (the
  // final resolution is the only event). Accepted leak: unmounting mid-input
  // (item switch / New chat) drops that downvote entirely.
  const choose = (next: 'up' | 'down') => {
    if (rating === next) return // latched: re-clicking the chosen thumb is a no-op
    setRating(next)
    setReason('')
    if (next === 'up') {
      setReasonOpen(false)
      onFeedback('up')
    } else {
      setReasonOpen(true)
    }
  }

  const resolveDown = (withReason: boolean) => {
    const trimmed = reason.trim()
    if (withReason && !trimmed) return
    onFeedback('down', withReason ? trimmed : undefined)
    setReasonOpen(false)
    setReason('')
  }

  return (
    <>
      <div className="ms-auto flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Good answer"
          aria-pressed={rating === 'up'}
          onClick={() => choose('up')}
          className={cn(rating === 'up' && 'text-foreground')}
        >
          {rating === 'up' ? (
            <HandThumbUpSolidIcon className="size-4" />
          ) : (
            <HandThumbUpIcon className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Bad answer"
          aria-pressed={rating === 'down'}
          onClick={() => choose('down')}
          className={cn(rating === 'down' && 'text-foreground')}
        >
          {rating === 'down' ? (
            <HandThumbDownSolidIcon className="size-4" />
          ) : (
            <HandThumbDownIcon className="size-4" />
          )}
        </Button>
      </div>
      {reasonOpen && (
        <div className="flex w-full items-center gap-1.5">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What was wrong? (optional)"
            aria-label="Feedback reason"
            maxLength={500}
            className="h-8 flex-1 text-[13px]"
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter bubbles to the panel handler (insert the last
              // answer) instead of sending the reason.
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                resolveDown(true)
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => resolveDown(true)}
            disabled={!reason.trim()}
          >
            Send
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss feedback reason"
            onClick={() => resolveDown(false)}
          >
            <XMarkIcon className="size-4" />
          </Button>
        </div>
      )}
    </>
  )
}

function CopilotAskInput({
  inputRef,
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
  /** See CopilotPanel's askInputRef: the textarea node for outside focus. */
  inputRef?: Ref<HTMLTextAreaElement>
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
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          disabled={busy}
          className="resize-none border-0 pe-16 shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // Cmd/Ctrl+Enter with a drafted question SUBMITS it (the chat-app
            // muscle memory); only an empty input lets the chord bubble to the
            // panel's own keydown handler (insert the last answer).
            if (e.metaKey || e.ctrlKey) {
              if (value.trim()) {
                e.preventDefault()
                e.stopPropagation()
                onSubmit()
              }
              return
            }
            // Plain Enter submits; Shift+Enter inserts a newline.
            if (!e.shiftKey) {
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
