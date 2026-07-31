import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationEndReason, ConversationStatus } from '@/lib/shared/conversation/types'
import { isMissingRequiredAttributesMessage } from '@/lib/shared/conversation/attribute-values'
import {
  setConversationStatusFn,
  restoreConversationFromSpamFn,
} from '@/lib/server/functions/conversation'
import { RequiredAttributesDialog } from './required-attributes-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Compact label for a snooze wake time, in the agent's local (workspace) time. */
const wakeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * The conversation status control: Open and Closed set the status directly;
 * picking Open again wakes a snoozed thread ("unsnooze"). Snoozing itself
 * (presets + a custom wake time) moved to the thread header's dedicated moon
 * icon (unified inbox §2.7) — this control only shows the CURRENT snoozed-
 * until label when applicable. Used in the detail panel's Properties row and
 * the thread header's narrow-viewport fallback.
 *
 * A spam-ended conversation (endReason 'spam') reads as "Spam" and offers a
 * single action — restore — which reopens the thread and clears the spam
 * marker, returning it to every triage list. The plain open/closed items stay
 * hidden in that state so the way out of spam is always the marker-clearing
 * restore, never a bare reopen that would leave the thread mislabeled.
 */
export function StatusControl({
  conversationId,
  status,
  snoozedUntil,
  endReason,
  onChanged,
}: {
  conversationId: ConversationId
  status: ConversationStatus
  /** Wake time (ISO) when snoozed until a specific instant; null otherwise. */
  snoozedUntil?: string | null
  /** Why the conversation was ended; 'spam' switches the control to restore. */
  endReason?: ConversationEndReason | null
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  // Required-to-close refusal from the server: raise the blocking prompt
  // instead of a generic error toast.
  const [closeBlocked, setCloseBlocked] = useState<string[] | null>(null)
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'thread', conversationId] })
    onChanged()
  }
  const statusMut = useMutation({
    mutationFn: (next: ConversationStatus) =>
      setConversationStatusFn({ data: { conversationId, status: next } }),
    onSuccess: invalidate,
    onError: (error) => {
      if (error instanceof Error && isMissingRequiredAttributesMessage(error.message)) {
        setCloseBlocked([error.message])
      } else {
        toast.error('Failed to update status')
      }
    },
  })
  const restoreMut = useMutation({
    mutationFn: () => restoreConversationFromSpamFn({ data: { conversationId } }),
    onSuccess: () => {
      toast.success('Conversation restored from spam')
      invalidate()
    },
    onError: () => toast.error('Failed to restore conversation'),
  })
  const busy = statusMut.isPending || restoreMut.isPending

  const isSpam = endReason === 'spam'
  const wakeLabel =
    status === 'snoozed' && snoozedUntil ? wakeFormatter.format(new Date(snoozedUntil)) : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            title={wakeLabel ? `Snoozed until ${wakeLabel}` : undefined}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <span className="capitalize">{isSpam ? 'Spam' : status}</span>
            {wakeLabel && <span className="text-muted-foreground">· {wakeLabel}</span>}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isSpam ? (
            <DropdownMenuItem onClick={() => restoreMut.mutate()}>
              Restore from spam
            </DropdownMenuItem>
          ) : (
            <>
              {/* Open doubles as "unsnooze" — it clears any snooze timer. */}
              <DropdownMenuItem onClick={() => statusMut.mutate('open')} className="capitalize">
                open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => statusMut.mutate('closed')} className="capitalize">
                closed
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RequiredAttributesDialog messages={closeBlocked} onClose={() => setCloseBlocked(null)} />
    </>
  )
}
