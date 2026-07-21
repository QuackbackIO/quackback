/**
 * Copilot: a private, teammate-facing Q&A thread scoped to a single
 * conversation OR ticket (COPILOT-SIDEBAR-UX.md; item-scoped per unified
 * inbox §2.9). Renders inside the unified inbox detail panel's "Copilot" tab
 * (inbox-detail-panel.tsx). Streams against POST /api/admin/assistant/copilot
 * over TanStack AI's AG-UI protocol (useAguiTurn: the thread is the native
 * AG-UI message history; RUN_FINISHED.result carries the post-processed
 * CopilotFinalPayload), reuses AssistantAnswer for citation
 * rendering, and gates any internal-sourced answer behind a hard confirm
 * before it can reach a customer-facing composer (B.4's leak gate).
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
import {
  ArrowPathIcon,
  BoltIcon,
  ClipboardDocumentListIcon,
  EllipsisHorizontalIcon,
  FunnelIcon,
  PencilSquareIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  LockClosedIcon,
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
import { Button } from '@/components/ui/button'
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
  AssistantAnswer,
  AssistantWorkingTrace,
} from '@/components/shared/conversation/assistant-turn'
import { InternalSourcesConfirm } from '@/components/conversation/internal-sources-confirm'
import { CopilotProposedActionCard } from './copilot-proposed-action-card'
import { SaveAsMacroDialog } from './copilot-save-as-macro-dialog'
import {
  CopilotSourcesList,
  visibleSourceOptions,
  type SourceOption,
  type SourceType,
} from './copilot-sources'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'
import { useCopilotTransform } from '@/lib/client/hooks/use-copilot-transform'
import { GENERIC_ERROR } from '@/lib/client/utils/http-error'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  type CopilotAnswerType,
  type CopilotCitation,
  type CopilotFinalPayload,
  type CopilotProposedAction,
  type TransformKind,
} from '@/lib/shared/assistant/copilot-contract'
import {
  itemRefBody,
  recordCopilotEvent,
  type CopilotEventInput,
} from '@/lib/client/copilot-events'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import type { InboxItemRef } from '@/lib/shared/inbox/items'

const MAX_QUESTION_CHARS = 4000

/**
 * Panel-scoped bindings, surfaced in the inbox shortcut help panel. These are
 * NOT bound by use-inbox-keyboard — the panel's own keydown handler owns them
 * (they only fire while focus is inside the Copilot panel), so they live here
 * next to that handler rather than in the inbox action registry.
 */
export const COPILOT_PANEL_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘↵', label: 'Insert last Copilot answer (with the ask box empty)' },
]

/** The answer card's "Add to composer & modify" menu rows (P2-C.1): the tone
 *  transforms offered before inserting an answer into the composer. */
const MODIFY_ROWS: { transform: TransformKind; label: string }[] = [
  { transform: 'my_tone', label: 'My tone of voice' },
  { transform: 'more_friendly', label: 'More friendly' },
  { transform: 'more_formal', label: 'More formal' },
  { transform: 'more_concise', label: 'More concise' },
]

/** The quick actions: each is nothing more than a canned question submitted
 *  as an ordinary turn — the answer streams, classifies, and gains
 *  affordances exactly like a typed ask. Surfaced twice: as full-size cards
 *  in the empty state (title + description), and as compact pills above the
 *  ask box once a thread exists (label only). */
const QUICK_ACTIONS: ReadonlyArray<{
  /** Compact pill label (composer footer). */
  label: string
  /** Empty-state card title. */
  title: string
  /** Empty-state card description. */
  description: string
  icon: typeof ClipboardDocumentListIcon
  question: string
}> = [
  {
    label: 'Draft reply',
    title: 'Draft a reply',
    description: 'Use your knowledge base to draft a reply in your tone and style.',
    icon: PencilSquareIcon,
    question: 'Draft a reply to this conversation',
  },
  {
    label: 'Summarize',
    title: 'Catch me up',
    description: 'Get a quick summary of what has happened so far.',
    icon: ClipboardDocumentListIcon,
    question: 'Summarize this conversation and highlight the key points',
  },
  {
    label: 'Next steps',
    title: 'Suggest next steps',
    description: 'Get guidance on how to move this conversation forward.',
    icon: BoltIcon,
    question: 'Suggest the next steps to resolve this conversation',
  },
]

/** The usage event to record once an insert actually happens — carried
 *  alongside the text so the leak-gate confirm logs on proceed, never on the
 *  initial (possibly cancelled) click. Names the GESTURE kind (what was
 *  inserted); the destination axis is always 'reply' now that the panel's
 *  only insert target is the reply composer. `internalSourced` doubles as
 *  the leak-gate flag itself (requestInsert gates on it); it is absent on an
 *  unfinalized turn's events (no final frame ever carried the server-derived
 *  signal). */
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
  onInsert,
  askInputRef,
}: {
  /** The open item (unified inbox §2.9) grounds the turn on its thread. */
  item: InboxItemRef
  /** Retained for parent compatibility (the inbox passes workspace flags); the
   *  Answer-sources picker no longer keys off a feature flag — source
   *  availability is per-agent config the runtime enforces. */
  flags?: FeatureFlags | undefined
  /** Insert answer text into the host's reply composer — the panel's only
   *  insert target (there is no note path). */
  onInsert: (text: string) => void
  /** The ask textarea's DOM node, for hosts that focus it from outside
   *  (e.g. an inbox keyboard shortcut). */
  askInputRef?: Ref<HTMLTextAreaElement>
}) {
  const { principal } = useRouteContext({ from: '/admin' }) as { principal?: { id: string } | null }
  const assistantName = 'Copilot'
  const headerLabel = 'Copilot'

  const sourceOptions = useMemo(() => visibleSourceOptions(), [])
  const visibleTypes = useMemo(() => sourceOptions.map((o) => o.type), [sourceOptions])
  const { checked, toggle } = useSourceFilter(principal?.id, visibleTypes)
  const sourceTypesParam = checked.size === visibleTypes.length ? undefined : Array.from(checked)

  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [input, setInput] = useState('')
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null)
  const [saveMacroTurnId, setSaveMacroTurnId] = useState<string | null>(null)
  const {
    start,
    stop,
    clear: clearThread,
    rewindToTurn,
  } = useAguiTurn({ url: '/api/admin/assistant/copilot' })
  // Answer rewrites run independently from the ask/answer stream, so changing
  // a prior answer never aborts a follow-up question.
  const runTransform = useCopilotTransform(item)
  const [transformingTurnId, setTransformingTurnId] = useState<string | null>(null)
  const transforming = transformingTurnId !== null
  const nextIdRef = useRef(0)

  const busy = turns.some((t) => t.status === 'streaming')
  const saveMacroTurn = turns.find((t) => t.id === saveMacroTurnId) ?? null

  useEffect(() => stop, [stop])

  // Fire-and-forget usage logging (inserts + thumbs feedback). recordCopilotEvent
  // swallows every failure, so a logging hiccup can never affect the insert.
  const logEvent = useCallback(
    (event: Omit<CopilotEventInput, 'item'>) =>
      recordCopilotEvent({ item: itemRefBody(item), ...event }),
    [item]
  )

  // The single insert seam: route text into the host's reply composer AND
  // record the matching usage event, so the two can never be paired
  // inconsistently across call sites. The event keeps its gesture kind
  // (answer / transform); the destination is always the reply composer.
  const performInsert = useCallback(
    (text: string, event: InsertEventMeta) => {
      onInsert(text)
      logEvent({ ...event, destination: 'reply' })
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
        performInsert(text, event)
      }
    },
    [performInsert]
  )

  const modifyAnswer = useCallback(
    async (turn: CopilotTurn, transform: TransformKind) => {
      if (transforming || !turn.answer) return
      setTransformingTurnId(turn.id)
      try {
        const result = await runTransform(transform, turn.answer)
        if (result) {
          requestInsert(result, { eventType: 'transform_inserted', ...turnMeta(turn) })
        }
      } finally {
        setTransformingTurnId(null)
      }
    },
    [transforming, runTransform, requestInsert]
  )

  const runTurn = useCallback(
    async (id: string, question: string) => {
      const patch = (p: Partial<CopilotTurn>) =>
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)))

      let answer = ''
      let finished = false

      // History rides the AG-UI thread natively (useChat re-sends its
      // accumulated messages); only the item ref and source filter travel on
      // forwardedProps.
      await start({
        question,
        forwardedProps: {
          ...itemRefBody(item),
          ...(sourceTypesParam ? { sourceTypes: sourceTypesParam } : {}),
        },
        handlers: {
          onTextDelta: (_delta, fullText) => {
            answer = fullText
            patch({ answer, activity: null })
          },
          onActivity: (status) => {
            patch({ activity: status })
          },
          onFinal: (payload) => {
            const final = payload as CopilotFinalPayload
            finished = true
            // The ONLY place `finalized` flips true: the flags below are
            // trustworthy exactly when this frame arrived. A suppressed
            // final's empty text stands; otherwise fall back to the streamed
            // text if the final somehow arrived without any.
            patch({
              answer: final.suppressed ? '' : final.text || answer,
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
          onError: (message) => {
            finished = true
            patch({ status: 'error', errorMessage: message })
          },
          onStreamEnd: () => {
            // Ended without a final frame (truncation or an intentional
            // stop): the turn stays unfinalized, so the card falls back to
            // the note-only affordance (see CopilotTurnView).
            if (!finished) patch({ status: 'done', activity: null })
          },
        },
      })
    },
    [item, sourceTypesParam, start]
  )

  const submitQuestion = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION_CHARS)
      if (!question || busy) return
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
      void runTurn(id, question)
    },
    [busy, runTurn]
  )

  const ask = useCallback(() => {
    if (!input.trim() || busy) return
    setInput('')
    submitQuestion(input)
  }, [input, busy, submitQuestion])

  const retry = useCallback(
    (id: string) => {
      if (busy) return
      const idx = turns.findIndex((t) => t.id === id)
      if (idx === -1) return
      const question = turns[idx].question
      // Rewind the native AG-UI thread to just before this turn's question so
      // the re-ask carries only the history that preceded it.
      rewindToTurn(idx)
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
      void runTurn(id, question)
    },
    [turns, busy, rewindToTurn, runTurn]
  )

  const newChat = useCallback(() => {
    if (busy) return
    clearThread()
    setTurns([])
    setInput('')
  }, [busy, clearThread])

  const handleAddToComposer = useCallback(
    (turn: CopilotTurn) =>
      requestInsert(turn.answer, { eventType: 'answer_inserted', ...turnMeta(turn) }),
    [requestInsert]
  )

  // Cmd/Ctrl+Enter anywhere inside the panel (COPILOT_PANEL_SHORTCUTS):
  // trigger the LAST completed answer's primary action — the same handler
  // the button calls, so the leak-gate confirm and usage logging apply
  // unchanged. The panel's dialogs (leak gate, save-as-macro) render in
  // portals outside this subtree, so their keydowns never reach this handler.
  const insertLastAnswer = useCallback(() => {
    if (busy || transforming) return // mirrors the buttons' disabled state
    const last = turns.findLast((t) => t.status === 'done' && !!t.answer && !t.suppressed)
    if (!last) return
    // Mirrors the card's affordances: only a finalized draft_reply answer has
    // a primary composer action. Analysis answers are read-only text, and an
    // unfinalized (aborted/truncated) turn fails closed — the final frame
    // carrying the server-derived leak-gate signal never arrived, so nothing
    // may route toward the customer-facing composer.
    if (!last.finalized || last.answerType === 'analysis') return
    handleAddToComposer(last)
  }, [busy, transforming, turns, handleAddToComposer])

  const onPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        insertLastAnswer()
      }
    },
    [insertLastAnswer]
  )

  return (
    // Bubble-phase only: fires for keydowns on the panel's own focusable
    // children (ask input, answer buttons), never globally.
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onPanelKeyDown}>
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Avatar src={null} name={assistantName} className="size-6 text-xs" />
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
          <CopilotEmptyState assistantName={assistantName} onQuickAction={submitQuestion} />
        ) : (
          <div className="space-y-4">
            {turns.map((turn) => (
              <CopilotTurnView
                key={turn.id}
                turn={turn}
                onAddToComposer={() => handleAddToComposer(turn)}
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
                isTransforming={transformingTurnId === turn.id}
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
        onQuickAction={submitQuestion}
        onStop={stop}
        busy={busy}
        hasAskedBefore={turns.length > 0}
        sourceOptions={sourceOptions}
        checked={checked}
        onToggleSource={toggle}
      />

      <SaveAsMacroDialog
        turn={saveMacroTurn}
        onOpenChange={(open) => !open && setSaveMacroTurnId(null)}
      />

      <InternalSourcesConfirm
        open={!!pendingInsert}
        noun="answer"
        confirmLabel="Add to composer anyway"
        onConfirm={() => {
          if (pendingInsert) performInsert(pendingInsert.text, pendingInsert.event)
          setPendingInsert(null)
        }}
        onCancel={() => setPendingInsert(null)}
      />
    </div>
  )
}

function CopilotEmptyState({
  assistantName,
  onQuickAction,
}: {
  assistantName: string
  /** Submit a QUICK_ACTIONS canned question as an ordinary turn. */
  onQuickAction: (question: string) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-1 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
          <SparklesIcon className="size-6 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Ask {assistantName} anything about this conversation.
          </p>
          <p className="text-xs text-muted-foreground">
            Answers draw on your help center, snippets, roadmap, and this customer&apos;s history.
          </p>
        </div>
      </div>
      <div className="w-full space-y-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onQuickAction(action.question)}
            className="w-full rounded-xl border border-border/60 bg-card/60 px-3.5 py-3 text-left transition-colors hover:border-border hover:bg-muted/60"
          >
            <span className="flex items-start gap-3">
              <action.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{action.title}</span>
                <span className="text-xs text-muted-foreground">{action.description}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="space-y-1 text-center text-[11px] text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <LockClosedIcon className="size-3.5 shrink-0" />
          Chats are private to you.
        </p>
        <p className="flex items-center justify-center gap-1.5">
          <ShieldCheckIcon className="size-3.5 shrink-0" />
          Can take actions for you, with your approval.
        </p>
      </div>
    </div>
  )
}

function CopilotTurnView({
  turn,
  onAddToComposer,
  onSaveAsMacro,
  onRetry,
  onModify,
  onFeedback,
  transformBusy,
  isTransforming,
}: {
  turn: CopilotTurn
  onAddToComposer: () => void
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
  // Analysis answers (guidance/reasoning about the conversation, not a reply
  // to send) are read-only text: no primary action, with "Add to composer"
  // demoted into the overflow menu as the escape hatch — inserting internal
  // analysis into a customer-facing reply is the exact mismatch answerType
  // exists to fix. A draft_reply answer (and every un-classified one, which
  // defaults to it) keeps "Add to composer" primary.
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
              // closed: no insert action at all, feedback only.
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <CopilotTurnFeedback onFeedback={onFeedback} />
              </div>
            )}
            {!streaming && turn.answer && turn.finalized && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {!isAnalysis && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onAddToComposer}
                    disabled={actionsDisabled}
                  >
                    Add to composer
                  </Button>
                )}
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
  onQuickAction,
  onStop,
  busy,
  hasAskedBefore,
  sourceOptions,
  checked,
  onToggleSource,
}: {
  /** See CopilotPanel's askInputRef: the textarea node for outside focus. */
  inputRef?: Ref<HTMLTextAreaElement>
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Submit a QUICK_ACTIONS canned question as an ordinary turn. */
  onQuickAction: (question: string) => void
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
      {/* Compact quick-action pills only once a thread exists — the empty
          state surfaces the same actions as full-size cards. */}
      {hasAskedBefore && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant="outline"
              size="sm"
              shape="pill"
              onClick={() => onQuickAction(action.question)}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
            >
              <action.icon className="size-3.5" />
              {action.label}
            </Button>
          ))}
        </div>
      )}
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
