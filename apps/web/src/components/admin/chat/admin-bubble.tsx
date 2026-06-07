import { useState } from 'react'
import {
  EllipsisVerticalIcon,
  TrashIcon,
  PencilSquareIcon,
  EnvelopeIcon,
  FaceSmileIcon,
  FlagIcon as FlagSolidIcon,
} from '@heroicons/react/24/solid'
import { FlagIcon } from '@heroicons/react/24/outline'
import { Avatar } from '@/components/ui/avatar'
import { ChatAttachmentList } from '@/components/shared/chat-attachments'
import { ReactionChip } from '@/components/shared/reaction-chip'
import { NoteContent } from './note-content'
import { DraftPostCardAdmin } from './draft-post-card-admin'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { REACTION_EMOJIS } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'
import type { AgentChatMessageDTO } from '@/lib/shared/chat/types'

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** A thin "New" divider rendered immediately above the first unread message. */
export function UnreadDivider() {
  return (
    <div className="my-1.5 flex items-center gap-2" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-primary/30" />
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        New
      </span>
      <span className="h-px flex-1 bg-primary/30" />
    </div>
  )
}

interface AdminBubbleProps {
  message: AgentChatMessageDTO
  onDelete: () => void
  /** Toggle the caller's reaction with `emoji` (hasReacted = current state). */
  onToggleReaction: (emoji: string, hasReacted: boolean) => void
  /** Set/clear the team-wide flag (next = the desired flagged state). */
  onToggleFlag: (next: boolean) => void
  /** Mark the conversation unread from this message. */
  onMarkUnread: () => void
  /** Briefly flash this row (deep-link / "Saved for later" jump target). */
  highlighted?: boolean
}

export function AdminBubble({
  message,
  onDelete,
  onToggleReaction,
  onToggleFlag,
  onMarkUnread,
  highlighted = false,
}: AdminBubbleProps) {
  // Keep the hover toolbar visible while its emoji popover or overflow menu is
  // open (the pointer leaves the row to interact with the portal'd content).
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // A draft-post / post_ref card the agent proposed or shared: render it
  // read-only (the visitor is the one who acts) — no avatar/toolbar, just the
  // content + its current state, which the card_updated stream keeps live.
  if (message.card) {
    return (
      <div className="py-1">
        <DraftPostCardAdmin card={message.card} cardView={message.cardView} />
      </div>
    )
  }

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

  // Visitor messages, agent replies, and internal notes all share one threaded
  // layout + hover toolbar (reactions, flag, mark-unread, delete). An internal
  // note keeps its agent-only distinction via an amber tint + an "Internal note"
  // badge and renders its rich TipTap body, but otherwise behaves identically.
  const isNote = message.isInternal
  const isAgent = message.senderType === 'agent'
  const authorName = message.author?.displayName ?? (isAgent ? 'Agent' : 'Visitor')
  const isFlagged = message.flaggedAt !== null
  const toolbarPinned = emojiOpen || menuOpen

  return (
    <div
      // The scroll/flash target for "jump to message" deep-links.
      data-message-id={message.id}
      className={cn(
        'group relative -mx-2 flex gap-2.5 rounded-md px-2 py-1 transition-colors',
        isFlagged
          ? 'bg-amber-500/10 hover:bg-amber-500/15'
          : isNote
            ? 'bg-amber-400/5 hover:bg-amber-400/10'
            : 'hover:bg-muted/40',
        // Animated flash for motion users; a static brand ring as the
        // reduced-motion equivalent (no background fight with the row's tint).
        highlighted &&
          'motion-safe:animate-flash-highlight motion-reduce:ring-2 motion-reduce:ring-inset motion-reduce:ring-primary/50'
      )}
    >
      <Avatar
        src={message.author?.avatarUrl ?? null}
        name={authorName}
        className="mt-0.5 size-9 shrink-0 text-xs"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{authorName}</span>
          {isNote && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              <PencilSquareIcon className="h-3 w-3" /> Internal note
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/50">
            {message.viaEmail && (
              <EnvelopeIcon
                className="h-3 w-3"
                aria-label="Received by email"
                title="Received by email"
              />
            )}
            {timeLabel(message.createdAt)}
          </span>
          {/* Flag marker sits right after the time. */}
          {isFlagged && (
            <FlagSolidIcon
              className="h-3.5 w-3.5 shrink-0 text-amber-500"
              aria-label="Flagged"
              title="Flagged"
            />
          )}
        </div>
        {isNote ? (
          <NoteContent
            content={message.content}
            contentJson={message.contentJson}
            className="mt-0.5 text-sm text-foreground/90"
          />
        ) : (
          message.content && (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {message.content}
            </div>
          )
        )}
        {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} />}
        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <ReactionChip
                key={r.emoji}
                emoji={r.emoji}
                count={r.count}
                hasReacted={r.hasReacted}
                reactors={r.reactors}
                onToggle={() => onToggleReaction(r.emoji, r.hasReacted)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hover toolbar */}
      <div
        className={cn(
          'absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm transition-opacity',
          toolbarPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
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
                      onToggleReaction(emoji, has)
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
          onClick={() => onToggleFlag(!isFlagged)}
          className={cn(
            'flex size-7 items-center justify-center rounded transition-colors hover:bg-muted',
            isFlagged ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label={isFlagged ? 'Remove flag' : 'Flag message'}
          aria-pressed={isFlagged}
        >
          {isFlagged ? <FlagSolidIcon className="h-4 w-4" /> : <FlagIcon className="h-4 w-4" />}
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
            <DropdownMenuItem onClick={onMarkUnread}>
              <EnvelopeIcon className="h-4 w-4" /> Mark unread
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <TrashIcon className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
