/**
 * Interactive affordances for the Phase C conversational block layer
 * (PHASE-C-CONVERSATIONAL-UX-BRIEF.md §5). The block's PROMPT (the rich text
 * a `buttons`/`collect`/`collectReply`/`csat` message carries) renders as an
 * ordinary `VisitorMessageBubble` — same as any assistant message — via
 * `message.contentJson`/`content` at the call site; this module renders only
 * the affordance BELOW that bubble: the button stack, the one-field collect
 * control, or the CSAT emoji row. A `message` or `replyTime` block has no
 * affordance at all (nothing here renders for those kinds) — `message` is a
 * free assistant bubble and `replyTime` renders as its own quiet caption
 * (`BlockReplyTimeCaption`), never a chat bubble.
 *
 * Every affordance derives its presentation from `state` (conversation-
 * rows.ts's pure derivation — never client memory) plus, for CSAT only, a
 * small piece of LOCAL interaction phase that must survive the state flipping
 * from 'pending' to 'chosen' mid-interaction (the rating tap's own SSE echo
 * lands while the visitor is still filling out the optional comment).
 */
import { useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { motion, useReducedMotion } from 'framer-motion'
import { CSAT_FACES } from '@/lib/shared/db-types'
import type { WorkflowBlockPayload } from '@/lib/shared/db-types'
import type { BlockState } from './conversation-rows'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'

const optionButtonClass =
  'w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-start text-sm font-medium text-foreground shadow-xs transition-colors'

/**
 * Reply-buttons stack: full-width, vertical, arrival-order, entrance-
 * animated. Pending is tappable; chosen collapses to nothing (the visitor's
 * own echoed choice arrives as its own bubble via the ordinary SSE flow);
 * superseded renders the same stack inert/dimmed, never tappable.
 */
export function BlockButtonsRow({
  block,
  state,
  submitting,
  onTap,
}: {
  block: Extract<WorkflowBlockPayload, { kind: 'buttons' }>
  state: BlockState
  /** True from the moment a button is tapped until the SSE echo lands
   *  (or the send fails) — the optimistic disable (contract idempotency: a
   *  losing double-tap must never fire twice). */
  submitting: boolean
  onTap: (buttonKey: string, label: string) => void
}) {
  const reduceMotion = useReducedMotion()
  if (state === 'chosen') return null
  const inert = state === 'superseded'
  return (
    <div className="mt-1.5 flex w-full max-w-[85%] flex-col gap-1.5" role="group">
      {block.options.map((option, i) => (
        <motion.button
          key={option.key}
          type="button"
          disabled={inert || submitting}
          aria-disabled={inert}
          onClick={() => !inert && !submitting && onTap(option.key, option.label)}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: inert ? 0.45 : 1, y: 0 }}
          transition={{
            duration: 0.18,
            ease: [0.32, 0.72, 0, 1],
            delay: reduceMotion ? 0 : i * 0.04,
          }}
          className={cn(
            optionButtonClass,
            inert
              ? 'cursor-default grayscale'
              : 'cursor-pointer hover:border-primary/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
          )}
        >
          {option.label}
        </motion.button>
      ))}
    </div>
  )
}

/** Inline validation for a `collect` block's single field, per its
 *  `fieldType`. Returns the error message key, or null when valid. */
function validateCollect(
  block: Extract<WorkflowBlockPayload, { kind: 'collect' }>,
  raw: string
): 'required' | 'number' | null {
  const trimmed = raw.trim()
  if (!trimmed) return block.required ? 'required' : null
  if (block.fieldType === 'number' && Number.isNaN(Number(trimmed))) return 'number'
  return null
}

/**
 * One-field-at-a-time inline prompt for `collect` — type-appropriate control
 * (text/number/select/date from the attribute definition snapshot) with
 * inline validation. `collectReply` (free-text, no field UI of its own — the
 * always-enabled composer IS its affordance) only ever reaches the 'chosen'
 * branch here, for the write-once explainer.
 *
 * Deliberately its own control rather than reusing admin's
 * `AttributeValueInput` (components/admin/conversation/attribute-value-
 * input.tsx), which renders the same text/number/select/date cases off the
 * same field-type union. Checked: its only cross-module import is
 * `ConversationAttributeItem`, and that's `import type` — so reusing it
 * wouldn't actually drag admin-only runtime code into this module (which the
 * widget bundle pulls in). The reasons to still keep this one local are
 * behavioral, the same class of "one canonical source, but the customer-
 * facing surface needs its own presentation layer" call the message-
 * variables.ts split (lib/shared/workflows/message-variables.ts) makes for
 * the variable catalogue: AttributeValueInput's copy ("None", "Choose
 * value…") is hardcoded English with no react-intl — every string on this
 * customer-facing surface is translated via useIntl above; its select always
 * offers a "None"/unset option, which doesn't fit a `required` collect field
 * that has no unset state until submit; and it has no Enter-to-submit or
 * inline required/number validation, both of which this block needs and
 * AttributeValueInput doesn't attempt (it's a bare value control, not a
 * submit flow). Reusing it would mean forking its internals to add all of
 * that back — not actually reuse.
 */
export function BlockCollectField({
  block,
  state,
  submitting,
  onSubmit,
}: {
  block:
    | Extract<WorkflowBlockPayload, { kind: 'collect' }>
    | Extract<WorkflowBlockPayload, { kind: 'collectReply' }>
  state: BlockState
  submitting: boolean
  onSubmit: (value: string, displayText: string) => void
}) {
  const intl = useIntl()
  const [value, setValue] = useState('')
  const [error, setError] = useState<'required' | 'number' | null>(null)

  if (block.kind === 'collectReply') {
    // No dedicated field — the composer answers it. Only the write-once note
    // (once answered) has a home here.
    if (state !== 'chosen') return null
    return <WriteOnceExplainer />
  }

  if (state === 'chosen') return <WriteOnceExplainer />
  const inert = state === 'superseded'

  const submit = () => {
    const problem = validateCollect(block, value)
    if (problem) {
      setError(problem)
      return
    }
    if (block.fieldType === 'select') {
      const option = block.options?.find((o) => o.id === value)
      onSubmit(value, option?.label ?? value)
    } else {
      onSubmit(value.trim(), value.trim())
    }
  }

  const errorText =
    error === 'required'
      ? intl.formatMessage({
          id: 'widget.messenger.block.collect.required',
          defaultMessage: 'This field is required.',
        })
      : error === 'number'
        ? intl.formatMessage({
            id: 'widget.messenger.block.collect.invalidNumber',
            defaultMessage: 'Enter a number.',
          })
        : null

  return (
    <div className="mt-1.5 flex w-full max-w-[85%] flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {block.fieldType === 'select' ? (
          <Select
            disabled={inert || submitting}
            value={value || undefined}
            onValueChange={(v) => {
              setValue(v)
              setError(null)
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue
                placeholder={intl.formatMessage({
                  id: 'widget.messenger.block.collect.choose',
                  defaultMessage: 'Choose…',
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {(block.options ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={
              block.fieldType === 'number' ? 'number' : block.fieldType === 'date' ? 'date' : 'text'
            }
            value={value}
            disabled={inert || submitting}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-invalid={!!error}
            className="h-9 text-sm"
          />
        )}
        <button
          type="button"
          disabled={inert || submitting}
          onClick={submit}
          className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FormattedMessage id="widget.messenger.block.collect.submit" defaultMessage="Submit" />
        </button>
      </div>
      {errorText && <p className="text-[11px] text-destructive">{errorText}</p>}
    </div>
  )
}

/** "Only our team can change this now" — shown once a collect/collectReply
 *  block is answered, setting the write-once expectation the contract's
 *  attribute-write-once rule enforces server-side. */
function WriteOnceExplainer() {
  return (
    <p className="mt-1 max-w-[85%] px-0.5 text-[11px] text-muted-foreground/70">
      <FormattedMessage
        id="widget.messenger.block.writeOnceExplainer"
        defaultMessage="Only our team can change this now."
      />
    </p>
  )
}

/**
 * Five-emoji CSAT row. The in-session interaction phase ('ask' -> 'rated' ->
 * 'done') is derived from two flat pieces of local state — `pickedRating`
 * (null until tapped) and `done` (the comment step closed out) — rather than
 * tracked as its own enum, since the triple is fully determined by them:
 * `pickedRating == null ? 'ask' : done ? 'done' : 'rated'`. This tracks
 * independently of the server-derived `state`, because the rating tap's own
 * SSE echo flips `state` to 'chosen' WHILE the visitor may still be filling
 * out the optional comment — collapsing the row at that instant would yank
 * the thank-you flow out from under them. A fresh mount that finds `state`
 * already 'chosen' or 'superseded' (a refresh, or a block answered in an
 * earlier session) has never advanced past 'ask' locally, so it collapses
 * exactly like a chosen/superseded button stack — the echoed rating already
 * renders as its own message bubble elsewhere.
 */
export function BlockCsatRow({
  block,
  state,
  submitting,
  onRate,
  onComment,
}: {
  block: Extract<WorkflowBlockPayload, { kind: 'csat' }>
  state: BlockState
  submitting: boolean
  onRate: (rating: number) => void
  /** `rating` is the face the visitor picked earlier THIS session (tracked
   *  locally — `row.message` for a csat block is the prompt itself, never
   *  the visitor's reply, so the call site has no other way to know it). */
  onComment: (rating: number, comment: string) => void
}) {
  const intl = useIntl()
  const reduceMotion = useReducedMotion()
  const [pickedRating, setPickedRating] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [comment, setComment] = useState('')
  const localPhase = pickedRating == null ? 'ask' : done ? 'done' : 'rated'

  if (localPhase === 'ask' && (state === 'chosen' || state === 'superseded')) {
    return state === 'superseded' ? (
      <div className="mt-1.5 flex max-w-[85%] justify-start gap-1 opacity-45 grayscale" aria-hidden>
        {CSAT_FACES.map((face) => (
          <span key={face} className="text-lg leading-none">
            {face}
          </span>
        ))}
      </div>
    ) : null
  }

  const commentPrompt =
    block.commentPrompt ||
    intl.formatMessage({
      id: 'widget.messenger.csat.commentPrompt',
      defaultMessage: 'Thanks! Anything we could improve?',
    })

  return (
    <div className="mt-1.5 flex max-w-[85%] flex-col gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      {localPhase === 'ask' ? (
        <div className="flex justify-start gap-1">
          {CSAT_FACES.map((face, i) => (
            <button
              key={face}
              type="button"
              disabled={submitting}
              onClick={() => {
                setPickedRating(i + 1)
                onRate(i + 1)
              }}
              aria-label={`${i + 1} of 5`}
              className="text-lg leading-none transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {face}
            </button>
          ))}
        </div>
      ) : localPhase === 'rated' ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="flex flex-col gap-2 overflow-hidden"
        >
          <p className="text-xs text-muted-foreground">{commentPrompt}</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={2000}
            aria-label={intl.formatMessage({
              id: 'widget.messenger.csat.commentPlaceholder',
              defaultMessage: 'Add a comment (optional)',
            })}
            placeholder={intl.formatMessage({
              id: 'widget.messenger.csat.commentPlaceholder',
              defaultMessage: 'Add a comment (optional)',
            })}
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => {
              setDone(true)
              if (pickedRating != null) onComment(pickedRating, comment.trim())
            }}
            className="self-start rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FormattedMessage id="widget.messenger.csat.send" defaultMessage="Send feedback" />
          </button>
        </motion.div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="widget.messenger.csat.thanks"
            defaultMessage="Thanks for your feedback!"
          />
        </p>
      )}
    </div>
  )
}

/** "We're online — typically replies in under an hour" / away variant — a
 *  quiet system-style caption (never a chat bubble), localized client-side
 *  from `block.status` (the message's stored `content` is only the English
 *  transcript/email fallback). */
export function BlockReplyTimeCaption({
  status,
}: {
  status: Extract<WorkflowBlockPayload, { kind: 'replyTime' }>['status']
}) {
  return (
    <p className="px-1 py-1 text-center text-[11px] text-muted-foreground" role="status">
      {status === 'online' ? (
        <FormattedMessage
          id="widget.messenger.replyTime.online"
          defaultMessage="We're online — typically replies in under an hour."
        />
      ) : (
        <FormattedMessage
          id="widget.messenger.replyTime.away"
          defaultMessage="We're away right now. We'll get back to you as soon as we're back online."
        />
      )}
    </p>
  )
}
