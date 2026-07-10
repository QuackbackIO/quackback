/**
 * The conversation message bubbles, one per audience:
 *
 *  - AgentMessageBubble: the admin thread — same chat-bubble idiom as the
 *    messenger (avatar beside a bubble, attribution below), plus the
 *    agent-only affordances (reactions, flag/mark-unread/delete hover
 *    toolbar, track-as-feedback) arriving as props; absent props hide them.
 *    Internal notes keep 'self' geometry with an amber fill instead of the
 *    brand one.
 *  - VisitorMessageBubble: the messenger bubble — muted on the left for the
 *    team and assistant with an attribution line below, brand-colored on the
 *    right for the visitor.
 *
 * `bubbleClasses`/`bubbleContentTextClass` below are the shared surface
 * tokens both bubbles render from (UNIFIED-INBOX-SPEC.md §2.6) — geometry
 * and fill live in one place so the two idioms cannot drift apart.
 */
import { memo, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import {
  EllipsisVerticalIcon,
  TrashIcon,
  PencilSquareIcon,
  EnvelopeIcon,
  FaceSmileIcon,
  BookmarkIcon as BookmarkSolidIcon,
  ChatBubbleLeftRightIcon,
  AdjustmentsHorizontalIcon,
  LightBulbIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { BookmarkIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { Avatar } from '@/components/ui/avatar'
import { ConversationAttachmentList } from '@/components/shared/conversation-attachments'
import { ReactionChip } from '@/components/shared/reaction-chip'
import { NoteContent } from '@/components/admin/conversation/note-content'
import { isJumboEmojiMessage, JUMBO_EMOJI_CLASS } from '@/lib/shared/conversation/jumbo-emoji'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import type { EmbedOpenMode } from '@/components/shared/quackback-embed-card'
import { LinkPreviews } from '@/components/shared/link-preview-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { REACTION_EMOJIS, CSAT_FACES } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'
import type { TiptapContent, WorkflowBlockPayload } from '@/lib/shared/db-types'
import type { ConversationMessageId } from '@quackback/ids'
import type {
  AgentConversationMessageDTO,
  ConversationAttachment,
  ConversationMessageCitation,
} from '@/lib/shared/conversation/types'
import type { MessageTranslationDisplay } from '@/lib/shared/conversation/translation'
import type { BlockState } from '@/components/shared/conversation/conversation-rows'
import {
  AssistantSourcesTrace,
  AssistantAnswer,
} from '@/components/shared/conversation/assistant-turn'
import { PendingActionCard } from '@/components/conversation/pending-action-card'

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** `issue_type` -> "Issue type" — good enough for an attribute key with no
 *  display-name lookup available on the message payload (the block snapshot
 *  only ever carries the raw key). */
function humanizeAttributeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Read-only rendering of a conversational block's affordance for the agent
 * inbox (PHASE-C-CONVERSATIONAL-UX-BRIEF.md — the admin thread shows the
 * prompt bubble plus a passive summary of what the customer sees: a chip row
 * for buttons, a "waiting for" caption for collect, an inert emoji row for
 * CSAT. Never interactive — an agent cannot answer on the customer's behalf
 * by tapping here. `message`/`replyTime` blocks have no affordance beyond
 * the prompt bubble itself, so this renders nothing for them.
 *
 * `state` is the same conversation-rows.ts derivation the customer-facing
 * widget renders from (undefined only for a caller that hasn't threaded a
 * block-states map through yet, treated like 'pending' below so the summary
 * degrades to its original always-live look rather than guessing wrong).
 * Answered/superseded no longer render as if the block were still awaiting a
 * reply — collect flips its caption to a quiet "Answered", and buttons dims
 * to signal the options are no longer live (the "Waiting for: …" caption that
 * never resolved once the customer replied was the bug this fixes).
 */
function AgentBlockSummary({ block, state }: { block: WorkflowBlockPayload; state?: BlockState }) {
  const resolved = state === 'chosen' || state === 'superseded'
  switch (block.kind) {
    case 'buttons':
      return (
        <div
          className={cn('mt-1.5 flex flex-wrap gap-1', resolved && 'opacity-60 grayscale')}
          aria-hidden
        >
          {block.options.map((o) => (
            <Badge
              key={o.key}
              variant="outline"
              size="sm"
              shape="pill"
              className="bg-background/60"
            >
              {o.label}
            </Badge>
          ))}
        </div>
      )
    case 'collect':
    case 'collectReply':
      if (state === 'superseded') return null
      return (
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          {state === 'chosen'
            ? `Answered: ${humanizeAttributeKey(block.attributeKey)}`
            : `Waiting for: ${humanizeAttributeKey(block.attributeKey)}`}
        </p>
      )
    case 'csat':
      return (
        <div className="mt-1.5 flex gap-1 text-base leading-none opacity-70" aria-hidden>
          {CSAT_FACES.map((face) => (
            <span key={face}>{face}</span>
          ))}
        </div>
      )
    default:
      return null
  }
}

/** 'self' = the thread's own side (visitor in the messenger; agent/assistant
 *  outbound in the admin thread) — brand-primary fill, right-aligned. 'peer'
 *  = the other party — neutral muted fill, left-aligned. */
export type BubbleSide = 'self' | 'peer'

/**
 * The chat-bubble surface: geometry (max-width, radius, padding) is identical
 * for every side, only the fill + text color vary. Both `AgentMessageBubble`
 * and `VisitorMessageBubble` call this so admin and messenger bubbles cannot
 * drift apart. An internal note keeps 'self' geometry (it renders on the
 * agent's side of the admin thread) but swaps the fill for the amber tint
 * that has marked notes since the flat-row era — readable in both themes at
 * this opacity, same as the flag/note tints this replaces.
 *
 * `opts.agentSelf` scopes the softer fill to the admin thread's own side
 * (human replies and Quinn's replies alike) so a full workday of reading it
 * isn't spent against the saturated brand-primary yellow — human replies get
 * a soft blue, `opts.assistant` (Quinn's own replies) get a soft purple so
 * the two are visually distinct at a glance. Deliberately opt-in:
 * `VisitorMessageBubble` never passes it, so the customer-facing
 * widget/portal keeps the brand-primary bubble for the visitor's own
 * messages.
 */
export function bubbleClasses(
  side: BubbleSide,
  opts: { note?: boolean; agentSelf?: boolean; assistant?: boolean } = {}
): string {
  if (opts.note) {
    return 'max-w-[85%] rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-foreground'
  }
  if (side === 'self' && opts.agentSelf) {
    return opts.assistant
      ? 'max-w-[85%] rounded-2xl bg-purple-500/15 px-3.5 py-2.5 text-foreground dark:bg-purple-500/20'
      : 'max-w-[85%] rounded-2xl bg-blue-500/15 px-3.5 py-2.5 text-foreground dark:bg-blue-500/20'
  }
  return cn(
    'max-w-[85%] rounded-2xl px-3.5 py-2.5',
    side === 'self' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
  )
}

/** Rich (TipTap) content's text color has to match the bubble's fill — on the
 *  brand-primary bubble it needs `text-primary-foreground` so prose text
 *  isn't near-invisible; everywhere else it's the standard body tone. */
export function bubbleContentTextClass(
  side: BubbleSide,
  opts: { note?: boolean; agentSelf?: boolean } = {}
): string {
  if (opts.note) return 'text-foreground/90'
  if (side === 'self' && opts.agentSelf) return 'text-foreground/90'
  return side === 'self' ? 'text-primary-foreground' : 'text-foreground/90'
}

/** A thin "New" divider rendered immediately above the first unread message. */
export function UnreadDivider() {
  return (
    <div className="my-1.5 flex items-center gap-2" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-primary/30" />
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        New
      </span>
      <span className="h-px flex-1 bg-primary/30" />
    </div>
  )
}

interface AgentMessageBubbleProps {
  message: AgentConversationMessageDTO
  /** All callbacks below take the message's own id (or the whole message,
   *  where the caller needs its content) rather than being pre-bound to this
   *  row — so the parent can pass one stable, top-level `useCallback`
   *  dispatcher to every row instead of a fresh closure per message per
   *  render. That's what lets `memo` below actually skip unrelated rows on a
   *  re-render (perf review). */
  onDelete?: (messageId: ConversationMessageId) => void
  /** Toggle the caller's reaction with `emoji` (hasReacted = current state). */
  onToggleReaction?: (messageId: ConversationMessageId, emoji: string, hasReacted: boolean) => void
  /** Set/clear the team-wide flag (next = the desired flagged state). */
  onToggleFlag?: (messageId: ConversationMessageId, next: boolean) => void
  /** Mark the conversation unread from this message. */
  onMarkUnread?: (messageId: ConversationMessageId) => void
  /** Visitor-only: open the picker to share an existing post in the conversation. */
  onSharePost?: (message: AgentConversationMessageDTO) => void
  /** Visitor-only: open the full dialog prefilled from this message. */
  onTrackAsPost?: (message: AgentConversationMessageDTO) => void
  /** Internal-note only: act on the AI's `suggest_post` suggestion — opens the
   *  convert dialog seeded with the suggested board/title/content. */
  onTrackSuggestion?: (message: AgentConversationMessageDTO) => void
  /** Open an embedded post in the inbox's in-place `?post=` modal (the host owns
   *  the route-bound navigation so the agent never leaves the conversation). */
  onOpenPost?: (postId: string) => void
  /** Briefly flash this row (deep-link / "Saved for later" jump target). */
  highlighted?: boolean
  /** When true, render external link preview cards below non-note messages. */
  linkPreviews?: boolean
  /** P2-D.1 inbox translation: present only for a plain-text message (never a
   *  note, never a contentJson/rich message) while translation is active for
   *  the conversation. Lets the bubble show the translated text by default
   *  with a "Show original" toggle, in both directions (a fetched translation
   *  of an incoming customer message, or the teammate's pre-translation
   *  original of an outgoing reply that was translated before sending). */
  translation?: MessageTranslationDisplay
  /** This message's own interactive-block state (conversation-rows.ts's pure
   *  derivation), when `message.block` is an interactive kind — undefined for
   *  every other message, and for a caller that hasn't threaded a block-states
   *  map through (AgentBlockSummary then falls back to its original
   *  always-live rendering). Read-only: unlike the widget, the admin thread
   *  never lets an agent answer on the customer's behalf here. */
  blockState?: BlockState
}

interface VisitorMessageBubbleProps {
  content: string
  /** Rich TipTap doc (inline images / post embeds). When present it renders in
   *  place of the plain-text `content`; messages without it keep the text path. */
  contentJson?: TiptapContent | null
  /** 'peer' = agent/assistant (left, muted bubble + attribution below);
   *  'self' = the visitor (right, brand bubble, no attribution). */
  side?: 'peer' | 'self'
  authorName?: string
  /** Marks the author as the AI assistant in the attribution line. */
  isAssistant?: boolean
  /** Show an "AI" label badge after the assistant name. */
  showAiLabel?: boolean
  attachments?: ConversationAttachment[]
  /** KB sources for an AI reply. When present, a collapsed sources trace renders
   *  above the bubble and inline [n] markers in `content` become citation dots. */
  citations?: ConversationMessageCitation[]
  time?: string
  linkPreviews?: boolean
  getAuthHeaders?: () => Record<string, string>
  embedOpenMode?: EmbedOpenMode
}

export const AgentMessageBubble = memo(function AgentMessageBubble({
  message,
  onDelete = () => {},
  onToggleReaction = () => {},
  onToggleFlag = () => {},
  onMarkUnread = () => {},
  onSharePost,
  onTrackAsPost,
  onTrackSuggestion,
  onOpenPost,
  highlighted = false,
  linkPreviews = false,
  translation,
  blockState,
}: AgentMessageBubbleProps) {
  // Keep the hover toolbar visible while its emoji popover or overflow menu is
  // open (the pointer leaves the row to interact with the portal'd content).
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // System events (e.g. "assigned to …") are status notices, not messages:
  // centered, no avatar, no actions.
  if (message.senderType === 'system') {
    return (
      <div className="flex items-center gap-2 py-1" role="status">
        <span className="h-px flex-1 bg-border/40" />
        <span className="whitespace-nowrap px-2 text-[11px] text-muted-foreground">
          {message.content}
        </span>
        <span className="h-px flex-1 bg-border/40" />
      </div>
    )
  }

  // Visitor messages, agent replies, and internal notes all share one chat-
  // bubble layout + hover toolbar (reactions, flag, mark-unread, delete),
  // via the same `bubbleClasses` tokens VisitorMessageBubble uses below. An
  // internal note keeps 'self' geometry (it renders on the agent's side) but
  // swaps the fill for the amber tint and renders its rich TipTap body
  // through `NoteContent` instead of the reply renderer.
  const isNote = message.isInternal
  const isAgent = message.senderType === 'agent'
  const authorName = message.author?.displayName ?? (isAgent ? 'Agent' : 'Visitor')
  const isFlagged = message.flaggedAt !== null
  const toolbarPinned = emojiOpen || menuOpen
  // Agent replies, assistant turns, and notes all sit on the agent's side of
  // the thread; only the visitor's own message is the peer.
  const self = isAgent
  const side: BubbleSide = self ? 'self' : 'peer'
  // Notes never get the jumbo-emoji treatment — they keep their own body
  // renderer (mention chips), matching the pre-restyle behavior.
  const jumbo = !isNote && isJumboEmojiMessage(message.content, message.contentJson)
  // "Track as feedback" quick actions only apply to a visitor's own message (not
  // agent replies or internal notes) and only when the host wired them up.
  const showTrackActions =
    message.senderType === 'visitor' && !isNote && !!(onTrackAsPost || onSharePost)
  // Agent-only AI suggestion to track this note as a post (populated only on
  // internal notes the AI wrote via `suggest_post`); the chip is the one-click
  // entry into the convert dialog. Captured as a const so the click handler can
  // safely pass the narrowed (non-null) value into `onTrackSuggestion`.
  const suggestion = isNote ? message.postSuggestion : null
  // Agent-only pointer to a Quinn write-tool proposal awaiting approval
  // (populated only on the internal note that announced it); the card fetches
  // the live pending-action row itself, so this only needs to render once.
  const pendingAction = isNote ? message.assistantPendingAction : null

  return (
    <div
      // The scroll/flash target for "jump to message" deep-links.
      data-message-id={message.id}
      // Named group ("message") scopes the hover toolbar to this row only —
      // an unnamed `group` here would also satisfy every citation dot's own
      // `group-hover:` (AssistantAnswer's CitationDot, nested inside this
      // row), popping every citation's hovercard open at once instead of
      // just the one under the pointer.
      className={cn('group/message flex gap-2 py-1.5', self ? 'flex-row-reverse' : 'flex-row')}
    >
      <Avatar
        src={message.author?.avatarUrl ?? null}
        name={authorName}
        className="mt-0.5 size-7 shrink-0 text-[10px]"
      />

      {/* flex-1 gives the column a definite width; without it the column
          shrink-wraps its content and the bubble's percentage max-width
          resolves against an indefinite box, collapsing short plain-text
          messages to min-content (one character per line). */}
      <div className={cn('flex min-w-0 flex-1 flex-col', self ? 'items-end' : 'items-start')}>
        {message.isAssistant && message.citations.length > 0 && (
          <AssistantSourcesTrace citations={message.citations} />
        )}

        {/* The bubble and its hover toolbar share this positioning context so
            the toolbar anchors to the bubble's corner, not the row. The width
            cap lives HERE (a direct child of the definite-width column) and the
            bubble fills it — see the flex-1 comment above. */}
        <div className="relative w-fit max-w-[85%]">
          <div
            className={cn(
              jumbo
                ? 'max-w-full'
                : cn(
                    bubbleClasses(side, {
                      note: isNote,
                      agentSelf: true,
                      assistant: message.isAssistant,
                    }),
                    'max-w-full'
                  ),
              // Animated flash for motion users; a static brand ring as the
              // reduced-motion equivalent (no background fight with the fill).
              highlighted &&
                'motion-safe:animate-flash-highlight motion-reduce:ring-2 motion-reduce:ring-inset motion-reduce:ring-primary/50'
            )}
          >
            {isNote ? (
              <NoteContent
                content={message.content}
                contentJson={message.contentJson}
                className="text-sm text-foreground/90"
              />
            ) : jumbo ? (
              // A lone-emoji message renders large (Slack/iMessage style).
              <div className={JUMBO_EMOJI_CLASS}>{message.content}</div>
            ) : message.contentJson ? (
              // Rich reply (inline embeds / images). No mention overlay — replies
              // carry no @-mentions, unlike internal notes. An embedded post opens
              // in the admin `?post=` modal rather than navigating away.
              <EmbedHydration openMode="modal" onOpenInModal={onOpenPost}>
                <RichTextContent
                  content={message.contentJson}
                  className={cn(
                    'text-sm leading-relaxed',
                    bubbleContentTextClass(side, { agentSelf: true })
                  )}
                />
              </EmbedHydration>
            ) : message.isAssistant ? (
              // Quinn's reply: render the same markdown + inline citations the
              // customer sees, so the agent has full context — uncited replies
              // don't show raw markdown. No explicit text color: it inherits
              // the bubble's `text-primary-foreground` from `bubbleClasses`.
              <AssistantAnswer text={message.content} citations={message.citations} />
            ) : (
              message.content && (
                <>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {translation
                      ? translation.showingOriginal
                        ? translation.originalContent
                        : translation.translatedContent
                      : message.content}
                  </div>
                  {translation && (
                    <button
                      type="button"
                      onClick={translation.onToggleOriginal}
                      className="mt-0.5 text-[11px] text-muted-foreground/60 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                    >
                      {translation.showingOriginal
                        ? 'Show translation'
                        : `${translation.label} · Show original`}
                    </button>
                  )}
                </>
              )
            )}
            {message.attachments.length > 0 && (
              <ConversationAttachmentList attachments={message.attachments} />
            )}
            {linkPreviews && !isNote && (
              <LinkPreviews content={message.content} contentJson={message.contentJson} />
            )}
            {message.block && <AgentBlockSummary block={message.block} state={blockState} />}
          </div>

          {/* Hover toolbar: inbox affordances. Anchored to the bubble's
              inner-facing top corner (the side facing the thread's center) so
              it never gets clipped by the column edge or lands on top of the
              avatar. */}
          <div
            className={cn(
              'absolute -top-3 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm transition-opacity',
              self ? 'left-2' : 'right-2',
              toolbarPinned ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100'
            )}
          >
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Add reaction"
                >
                  <FaceSmileIcon className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1">
                <div className="flex gap-0.5">
                  {REACTION_EMOJIS.map((emoji) => {
                    const has = message.reactions.some((r) => r.emoji === emoji && r.hasReacted)
                    return (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`React with ${emoji}`}
                        aria-pressed={has}
                        onClick={() => {
                          onToggleReaction(message.id, emoji, has)
                          setEmojiOpen(false)
                        }}
                        className={cn(
                          'flex size-8 items-center justify-center rounded text-lg leading-none hover:bg-muted',
                          has && 'bg-primary/10'
                        )}
                      >
                        {emoji}
                      </button>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <button
              type="button"
              onClick={() => onToggleFlag(message.id, !isFlagged)}
              className={cn(
                'flex size-7 items-center justify-center rounded transition-colors hover:bg-muted',
                isFlagged ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label={isFlagged ? 'Remove flag' : 'Flag message'}
              aria-pressed={isFlagged}
            >
              {isFlagged ? (
                <BookmarkSolidIcon className="h-4 w-4" />
              ) : (
                <BookmarkIcon className="h-4 w-4" />
              )}
            </button>

            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="More actions"
                >
                  <EllipsisVerticalIcon className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onMarkUnread(message.id)}>
                  <EnvelopeIcon className="h-4 w-4" /> Mark unread
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(message.id)}>
                  <TrashIcon className="h-4 w-4" /> Delete
                </DropdownMenuItem>
                {showTrackActions && (
                  <>
                    <DropdownMenuSeparator />
                    {onSharePost && (
                      <DropdownMenuItem onClick={() => onSharePost(message)}>
                        <ChatBubbleLeftRightIcon className="h-4 w-4" /> Share a post…
                      </DropdownMenuItem>
                    )}
                    {onTrackAsPost && (
                      <DropdownMenuItem onClick={() => onTrackAsPost(message)}>
                        <AdjustmentsHorizontalIcon className="h-4 w-4" /> Track as feedback…
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Note-only follow-ups render as their own cards below the bubble
            (they already carry their own border/fill) rather than nested
            inside the note's amber surface. */}
        {isNote && suggestion && onTrackSuggestion && (
          <div className="flex max-w-[85%] flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <LightBulbIcon className="h-3.5 w-3.5" /> AI suggests tracking this as a post
            </span>
            <button
              type="button"
              onClick={() => onTrackSuggestion(message)}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Track as feedback
            </button>
          </div>
        )}
        {isNote && pendingAction && (
          <div className="max-w-[85%]">
            <PendingActionCard
              pendingActionId={pendingAction.pendingActionId}
              summary={pendingAction.summary}
            />
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <ReactionChip
                key={r.emoji}
                emoji={r.emoji}
                count={r.count}
                hasReacted={r.hasReacted}
                reactors={r.reactors}
                onToggle={() => onToggleReaction(message.id, r.emoji, r.hasReacted)}
              />
            ))}
          </div>
        )}

        {/* Attribution below the bubble, matching VisitorMessageBubble: name,
            optional AI/Internal-note badge, via-email icon, time, and the
            flagged bookmark glyph — flag state is a meta-line glyph now, not
            a row tint. */}
        <div
          className={cn(
            'mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground/70',
            self && 'flex-row-reverse'
          )}
        >
          <span className="truncate">{authorName}</span>
          {message.isAssistant && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <SparklesIcon className="h-3 w-3" /> AI
            </span>
          )}
          {isNote && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <PencilSquareIcon className="h-3 w-3" /> Internal note
            </span>
          )}
          {message.viaEmail && (
            <EnvelopeIcon
              className="h-3 w-3 shrink-0"
              aria-label="Received by email"
              title="Received by email"
            />
          )}
          <span>{timeLabel(message.createdAt)}</span>
          {isFlagged && (
            <BookmarkSolidIcon
              className="h-3.5 w-3.5 shrink-0 text-amber-500"
              aria-label="Flagged"
              title="Flagged"
            />
          )}
        </div>
      </div>
    </div>
  )
})

/**
 * A single visitor-facing message: a rounded bubble — muted on the left for the
 * team and assistant with a small attribution line below ("Name · AI Agent ·
 * time"), brand-colored on the right for the visitor — matching the modern
 * messenger bubble language. Lone-emoji messages render large without a bubble.
 */
export function VisitorMessageBubble({
  content,
  contentJson,
  side = 'peer',
  authorName,
  isAssistant = false,
  showAiLabel = false,
  attachments,
  citations,
  time,
  linkPreviews = false,
  getAuthHeaders,
  embedOpenMode = 'newTab',
}: VisitorMessageBubbleProps) {
  const self = side === 'self'
  const jumbo = isJumboEmojiMessage(content, contentJson)
  // Quinn's turns render as markdown-lite (the prompt encourages lists/bold), with
  // inline citation dots + a sources trace only when the answer was grounded.
  const isAiReply = !self && isAssistant
  const cited = isAiReply && citations && citations.length > 0 ? citations : null
  return (
    <div className={self ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
      {cited && <AssistantSourcesTrace citations={cited} />}
      <div className={jumbo ? 'max-w-[85%]' : bubbleClasses(side)}>
        {jumbo ? (
          // A lone-emoji message renders large (no bubble chrome).
          <div className={JUMBO_EMOJI_CLASS}>{content}</div>
        ) : contentJson ? (
          // Rich message (inline images / post embeds): hydrate embed cards into
          // the static rendered HTML, matching the changelog/inbox surfaces. The
          // widget's iframe origin may differ from the portal's, so an embedded
          // post opens its absolute URL in a new tab there.
          <EmbedHydration openMode={embedOpenMode} getAuthHeaders={getAuthHeaders}>
            <RichTextContent
              content={contentJson}
              className={cn('text-sm leading-relaxed', bubbleContentTextClass(side))}
            />
          </EmbedHydration>
        ) : (
          content &&
          (isAiReply ? (
            <AssistantAnswer text={content} citations={cited ?? []} />
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>
          ))
        )}
        {attachments && attachments.length > 0 && (
          <ConversationAttachmentList attachments={attachments} />
        )}
        {linkPreviews && (
          <LinkPreviews
            content={content}
            contentJson={contentJson}
            getAuthHeaders={getAuthHeaders}
          />
        )}
      </div>
      {/* Attribution below the bubble — team/assistant side only. */}
      {!self && (authorName || time) && (
        <div className="mt-1 px-1 flex items-center gap-1">
          <p className="text-[11px] text-muted-foreground/70">
            {authorName}
            {isAssistant && !showAiLabel && (
              <>
                {' · '}
                <FormattedMessage id="widget.messenger.aiAgent" defaultMessage="AI Agent" />
              </>
            )}
            {time && (
              <>
                {' · '}
                {time}
              </>
            )}
          </p>
          {isAssistant && showAiLabel && (
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              AI
            </span>
          )}
        </div>
      )}
    </div>
  )
}
