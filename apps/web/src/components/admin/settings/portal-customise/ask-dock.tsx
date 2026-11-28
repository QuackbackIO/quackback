import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
// The 24 set, which the admin already loads: the 20 set's sparkles belong to
// the Help Center's category icons, and sharing them costs the widget and the
// Help Center a request each.
import { SparklesIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { askPortalCustomiseFn } from '@/lib/server/functions/portal-customise'
import { track } from '@/lib/client/analytics'
import { cn } from '@/lib/shared/utils'
import {
  answerLocally,
  ASK_REPLIES,
  type AskPage,
  type PortalAskResponse,
} from '@/lib/shared/portal-customise/ask'
import { applyDraftPatch, summariseDraftForAsk } from './ask-draft'
import { summariseChange, type ChangeLine, type ChangeSummary } from './change-summary'
import type { ImportBrief } from './import-section'
import type { SectionId } from './pages'
import type { PortalDraft } from './portal-draft'

/** How many messages the chat keeps. */
const KEEP = 60

interface Message {
  id: number
  from: 'person' | 'ask'
  text: string
  /** What a change did to the draft: the reply lists it, with the one Undo. */
  summary?: ChangeSummary
  /** The draft that change made: its Undo is offered only while this is still the draft. */
  result?: PortalDraft
  undone?: boolean
  /** An import this request started: its reply follows the import. */
  importHost?: string
}

/** The reply to a request whose change the draft already has. */
const NOTHING_CHANGED = 'It already looks that way.'

interface AskDockProps {
  getDraft: () => PortalDraft
  update: (edit: (draft: PortalDraft) => PortalDraft) => void
  undo: () => void
  onImport: (host: string) => void
  /** A request changed the draft: what changed, for the preview's outlines. */
  onChanged?: (summary: ChangeSummary) => void
  page?: AskPage
  /** The last import in one line, for the reply to an import the chat started. */
  importBrief?: ImportBrief | null
  /**
   * A change made outside the chat that is replied to like one of its own (a
   * suggestion used in Import): the draft before and after it. A new `id`
   * is a new change.
   */
  notice?: { id: number; before: PortalDraft; after: PortalDraft } | null
  /**
   * Whether the chat has the panel, over the sections. Left out, the dock
   * keeps it itself; given, `onChatOpenChange` moves it.
   */
  chatOpen?: boolean
  onChatOpenChange?: (open: boolean) => void
  /** A reply's line, or an import's, opens the section that makes that change. */
  onOpenSection?: (section: SectionId) => void
}

/**
 * Ask for a change, docked under the sections. Plain requests are answered
 * here; the rest go to the server. A change lands in the draft as one step.
 * Once a conversation starts the chat takes the panel, over the sections,
 * with a way back; one place scrolls at a time.
 *
 * Memoised: it reads the draft only when asked (`getDraft`), so an edit made
 * in a section leaves it as it was. Every prop must keep its identity while
 * its value does.
 */
export const AskDock = memo(function AskDock({
  getDraft,
  update,
  undo,
  onImport,
  onChanged,
  page,
  importBrief = null,
  notice,
  chatOpen,
  onChatOpenChange,
  onOpenSection,
}: AskDockProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [ownOpen, setOwnOpen] = useState(false)
  const open = chatOpen ?? ownOpen
  const setOpen = (next: boolean) => {
    if (onChatOpenChange) onChatOpenChange(next)
    else setOwnOpen(next)
  }
  const nextId = useRef(0)
  const log = useRef<HTMLDivElement>(null)

  const say = (message: Omit<Message, 'id'>) =>
    setMessages((all) => [...all, { ...message, id: nextId.current++ }].slice(-KEEP))

  // The reply to a change made elsewhere: what it did, with the one Undo, as for a request.
  const noticed = useRef<number | null>(null)
  useEffect(() => {
    if (!notice || noticed.current === notice.id) return
    noticed.current = notice.id
    const summary = summariseChange(notice.before, notice.after)
    if (summary.lines.length === 0) return
    setMessages((all) =>
      [
        ...all,
        { id: nextId.current++, from: 'ask' as const, text: '', summary, result: notice.after },
      ].slice(-KEEP)
    )
  }, [notice])

  // The newest reply is always in view: the log follows it down.
  const lastImport = [...messages].reverse().find((m) => m.importHost)?.id
  useLayoutEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, busy, open, importBrief])

  async function ask(request: string) {
    const text = request.trim()
    if (!text || busy) return
    setValue('')
    setOpen(true)
    say({ from: 'person', text })
    setBusy(true)
    let answer: PortalAskResponse
    try {
      const draft = summariseDraftForAsk(getDraft())
      answer =
        answerLocally(text, draft) ??
        (await askPortalCustomiseFn({ data: { request: text, draft, page } }))
    } catch {
      answer = { outcome: 'refused', handled: 'refused', reply: ASK_REPLIES.notUnderstood }
    } finally {
      setBusy(false)
    }
    void track('portal_ask', { handled: answer.handled })
    switch (answer.outcome) {
      case 'patch': {
        // The reply is what the patch did to the draft, never what was said about it.
        const before = getDraft()
        const after = applyDraftPatch(before, answer.patch)
        const summary = summariseChange(before, after)
        if (summary.lines.length === 0) {
          // No step to take back: an Undo here would undo something older.
          say({ from: 'ask', text: NOTHING_CHANGED })
          return
        }
        update(() => after)
        onChanged?.(summary)
        say({ from: 'ask', text: answer.reply, summary, result: after })
        return
      }
      case 'undo':
        undo()
        say({ from: 'ask', text: answer.reply })
        return
      case 'import':
        onImport(answer.host)
        say({ from: 'ask', text: answer.reply, importHost: answer.host })
        return
      default:
        say({ from: 'ask', text: answer.reply })
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(value)
  }

  function openSection(section: SectionId) {
    setOpen(false)
    onOpenSection?.(section)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  // One Undo: on the reply whose change is the last thing that happened to the draft.
  const current = getDraft()

  return (
    <div
      onKeyDown={onKeyDown}
      className={cn(
        'flex flex-col bg-background',
        open ? 'min-h-0 flex-1' : 'border-t border-border'
      )}
    >
      {open ? (
        <>
          <div className="flex h-11 shrink-0 items-center border-b border-border px-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              <ChevronLeftIcon className="rtl:-scale-x-100 size-4" aria-hidden="true" />
              Sections
            </Button>
          </div>
          <div
            ref={log}
            role="log"
            aria-live="polite"
            aria-label="Chat"
            className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3 text-xs"
          >
            {messages.map((message) =>
              message.from === 'person' ? (
                <p
                  key={message.id}
                  className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-md bg-muted px-3 py-1.5 text-foreground [overflow-wrap:anywhere]"
                >
                  {message.text}
                </p>
              ) : message.summary ? (
                <ChangeReply
                  key={message.id}
                  summary={message.summary}
                  undone={message.undone === true}
                  canUndo={message.result === current}
                  onOpenSection={openSection}
                  onUndo={() => {
                    undo()
                    setMessages((all) =>
                      all.map((m) => (m.id === message.id ? { ...m, undone: true } : m))
                    )
                  }}
                />
              ) : message.importHost ? (
                <ImportReply
                  key={message.id}
                  host={message.importHost}
                  brief={message.id === lastImport ? importBrief : null}
                  onSee={() => openSection('import')}
                />
              ) : (
                <ReplyCard key={message.id}>
                  <p>{message.text}</p>
                </ReplyCard>
              )
            )}
            {busy ? <Thinking /> : null}
          </div>
        </>
      ) : null}
      <div className={cn('space-y-2 px-4 py-3', open && 'border-t border-border')}>
        {!open && messages.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Show chat
            <span className="tabular-nums">· {messages.length}</span>
            <ChevronRightIcon className="rtl:-scale-x-100 ms-auto size-4" aria-hidden="true" />
          </button>
        ) : null}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 focus-within:border-ring focus-within:shadow-[0_0_0_1px_var(--ring)]"
        >
          <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            data-bare-field
            aria-label="Ask for a change"
            placeholder="Ask for a change"
            autoComplete="off"
            maxLength={500}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Send"
            disabled={busy || !value.trim()}
            className="size-7"
          >
            <ArrowUpIcon className="size-4" aria-hidden="true" />
          </Button>
        </form>
      </div>
    </div>
  )
})

/** One reply, as one compact card. */
function ReplyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="me-4 space-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-foreground">
      {children}
    </div>
  )
}

/** While a request is worked on: three dots and the words, in the log where the reply will be. */
function Thinking() {
  return (
    <div className="flex items-center gap-2 px-1 text-muted-foreground">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      Working on it…
    </div>
  )
}

/** What a request changed, line by line (each opens its section), what the editor adjusted, and the one Undo. */
function ChangeReply({
  summary,
  undone,
  canUndo,
  onUndo,
  onOpenSection,
}: {
  summary: ChangeSummary
  undone: boolean
  /** The draft is still as this change left it. */
  canUndo: boolean
  onUndo: () => void
  onOpenSection: (section: SectionId) => void
}) {
  return (
    <ReplyCard>
      <ul className="-mx-1 space-y-px">
        {summary.lines.map((line) => (
          <li key={line.text}>
            <button
              type="button"
              onClick={() => onOpenSection(line.section)}
              className="group/line flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <LineMark line={line} />
              <span className="min-w-0 flex-1">{line.text}</span>
              <ChevronRightIcon
                className="rtl:-scale-x-100 size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/line:opacity-100 group-focus-visible/line:opacity-100"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
      {summary.adjustments.map((adjustment) => (
        <p key={adjustment} className="text-[11px] text-muted-foreground">
          {adjustment}
        </p>
      ))}
      {canUndo ? (
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onUndo}>
          Undo
        </Button>
      ) : undone ? (
        <p className="text-muted-foreground">Undone.</p>
      ) : null}
    </ReplyCard>
  )
}

/** The reply to an import the chat started: the read, then what it found in one line. */
function ImportReply({
  host,
  brief,
  onSee,
}: {
  host: string
  /** The import as it is now; none once a newer import has taken its place. */
  brief: ImportBrief | null
  onSee: () => void
}) {
  if (brief?.status === 'reading') {
    return (
      <ReplyCard>
        <p className="text-muted-foreground">Reading {brief.host}…</p>
      </ReplyCard>
    )
  }
  if (brief?.status === 'refused') {
    // What to do next (try again, a country's own site) lives in the section.
    return (
      <ReplyCard>
        <p>{brief.line}</p>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onSee}>
          Open Import
        </Button>
      </ReplyCard>
    )
  }
  return (
    <ReplyCard>
      <p>{brief?.line ?? `Imported ${host}.`}</p>
      <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onSee}>
        See what was imported
      </Button>
    </ReplyCard>
  )
}

/** Every line's leading mark, one slot wide: its colour, its shape, or a quiet dot. */
function LineMark({ line }: { line: ChangeLine }) {
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
      {line.swatchShape ? (
        <span
          className={cn(
            'h-2.5 w-4 border-[1.5px] border-foreground/60',
            line.swatchShape === 'square'
              ? 'rounded-none'
              : line.swatchShape === 'pill'
                ? 'rounded-full'
                : 'rounded-[3px]'
          )}
        />
      ) : line.swatch ? (
        <span
          // The exact colour, for anyone who wants it; the sentence names it plainly.
          title={line.swatch}
          className="size-3.5 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
          style={{ backgroundColor: line.swatch }}
        />
      ) : (
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      )}
    </span>
  )
}
