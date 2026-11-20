import { memo, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpIcon } from '@heroicons/react/20/solid'
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
import type { PortalDraft } from './portal-draft'

const SUGGESTIONS = [
  'Import stripe.com',
  'Use #1a73e8 for buttons',
  'Make the buttons less rounded',
  'Make the header navy',
  'Put Roadmap first',
]

interface Message {
  id: number
  from: 'person' | 'ask'
  text: string
  /** What a change did to the draft: the reply lists it, with the one Undo. */
  summary?: ChangeSummary
  /** The draft that change made: its Undo is offered only while this is still the draft. */
  result?: PortalDraft
  undone?: boolean
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
  /** An import has run: the Import suggestion is no longer useful. */
  importDone: boolean
  /**
   * A change made outside the chat that is replied to like one of its own (a
   * suggestion used in Import): the draft before and after it. A new `id`
   * is a new change.
   */
  notice?: { id: number; before: PortalDraft; after: PortalDraft } | null
}

/**
 * Ask for a change, docked under the sections. Plain requests are answered
 * here; the rest go to the server. A change lands in the draft as one step.
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
  importDone,
  notice,
}: AskDockProps) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const nextId = useRef(0)

  const say = (message: Omit<Message, 'id'>) =>
    setMessages((all) => [...all, { ...message, id: nextId.current++ }].slice(-6))

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
      ].slice(-6)
    )
  }, [notice])

  async function ask(request: string) {
    const text = request.trim()
    if (!text || busy) return
    setValue('')
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
        say({ from: 'ask', text: answer.reply })
        return
      default:
        say({ from: 'ask', text: answer.reply })
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(value)
  }

  // One Undo: on the reply whose change is the last thing that happened to the draft.
  const current = getDraft()
  const asked = new Set(messages.filter((m) => m.from === 'person').map((m) => m.text))
  const chips = focused
    ? SUGGESTIONS.filter((s) => !asked.has(s) && !(importDone && s.startsWith('Import')))
    : []

  return (
    <div className="space-y-2 border-t border-border bg-background px-4 py-3">
      {messages.length > 0 ? (
        <div role="log" aria-live="polite" className="max-h-52 space-y-1.5 overflow-y-auto text-xs">
          {messages.map((message) =>
            message.from === 'person' ? (
              <p key={message.id} className="ms-6 rounded-md bg-muted px-2 py-1.5 text-end">
                {message.text}
              </p>
            ) : message.summary ? (
              <ChangeReply
                key={message.id}
                summary={message.summary}
                undone={message.undone === true}
                canUndo={message.result === current}
                onUndo={() => {
                  undo()
                  setMessages((all) =>
                    all.map((m) => (m.id === message.id ? { ...m, undone: true } : m))
                  )
                }}
              />
            ) : (
              <p key={message.id} className="text-muted-foreground">
                {message.text}
              </p>
            )
          )}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              // Keeps the field focused, so the chips stay while one is sent.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void ask(chip)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {chip}
            </button>
          ))}
        </div>
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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
  )
})

/** What a request changed, line by line, what the editor adjusted, and the one Undo. */
function ChangeReply({
  summary,
  undone,
  canUndo,
  onUndo,
}: {
  summary: ChangeSummary
  undone: boolean
  /** The draft is still as this change left it. */
  canUndo: boolean
  onUndo: () => void
}) {
  return (
    <div className="space-y-1.5 py-0.5">
      <ul className="space-y-1">
        {summary.lines.map((line) => (
          <li key={line.text} className="flex items-center gap-1.5 text-foreground">
            <Swatch line={line} />
            {line.text}
          </li>
        ))}
      </ul>
      {summary.adjustments.map((adjustment) => (
        <p key={adjustment} className="text-muted-foreground">
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
    </div>
  )
}

/** A line's colour as a small chip, or for a line about corners, that shape in outline. */
function Swatch({ line }: { line: ChangeLine }) {
  if (line.swatchShape) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'h-2.5 w-4 shrink-0 border-[1.5px] border-foreground/60',
          line.swatchShape === 'square'
            ? 'rounded-none'
            : line.swatchShape === 'pill'
              ? 'rounded-full'
              : 'rounded-[3px]'
        )}
      />
    )
  }
  if (!line.swatch) return null
  return (
    <span
      // The exact colour, for anyone who wants it; the sentence names it plainly.
      title={line.swatch}
      aria-hidden="true"
      className="size-3 shrink-0 rounded-[3px] border border-foreground/15"
      style={{ backgroundColor: line.swatch }}
    />
  )
}
