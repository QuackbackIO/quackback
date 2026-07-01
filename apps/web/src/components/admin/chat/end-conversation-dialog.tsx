import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import {
  CONVERSATION_END_REASONS,
  CONVERSATION_END_REASON_LABELS,
  type ConversationEndReason,
} from '@/lib/shared/conversation/types'
import { endConversationFn } from '@/lib/server/functions/conversation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'

interface EndConversationDialogProps {
  conversationId: ConversationId
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the conversation is successfully ended (refresh the thread). */
  onEnded: () => void
}

/**
 * Agent action: end a conversation with a reason + optional note. The reason is
 * required (the confirm button stays disabled until one is picked); the note is
 * free-text on any reason. Recording the reason powers later resolution-rate
 * reporting.
 */
export function EndConversationDialog({
  conversationId,
  open,
  onOpenChange,
  onEnded,
}: EndConversationDialogProps) {
  const [reason, setReason] = useState<ConversationEndReason | null>(null)
  const [note, setNote] = useState('')

  // Reset the picked reason + note each time the dialog opens.
  useEffect(() => {
    if (open) {
      setReason(null)
      setNote('')
    }
  }, [open])

  const end = useMutation({
    mutationFn: (vars: { reason: ConversationEndReason; note: string }) =>
      endConversationFn({
        data: {
          conversationId,
          reason: vars.reason,
          note: vars.note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Conversation ended')
      onOpenChange(false)
      onEnded()
    },
    onError: () => toast.error('Failed to end conversation'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End conversation</DialogTitle>
          <DialogDescription>
            Pick a reason so this conversation counts toward your resolution stats. You can add an
            optional note for the team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5" role="radiogroup" aria-label="End reason">
            {CONVERSATION_END_REASONS.map((value) => {
              const selected = reason === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setReason(value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/60'
                  )}
                >
                  <span>{CONVERSATION_END_REASON_LABELS[value]}</span>
                  {selected && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end-note">Note (optional)</Label>
            <Textarea
              id="end-note"
              value={note}
              maxLength={2000}
              rows={3}
              placeholder="Add context for the team…"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!reason || end.isPending}
            onClick={() => reason && end.mutate({ reason, note })}
          >
            End conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
