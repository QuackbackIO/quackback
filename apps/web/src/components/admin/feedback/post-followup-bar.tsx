import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PostId } from '@quackback/ids'
import { getPostFollowupAudienceFn, sendPostFollowupFn } from '@/lib/server/functions/post-followup'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const BLOCKED_NOTE: Record<string, string> = {
  no_address: 'No address',
  opted_out: 'Opted out',
  already_sent: 'Already told',
}

/**
 * The reviewed follow-up (QUINN-PRODUCT P9).
 *
 * Silent unless there is somebody to tell: a board post with at least one
 * conversation linked as evidence. Nothing here sends on its own, and the
 * reviewer sees every recipient and every reason a recipient is unreachable
 * before the send rather than a count afterwards.
 */
export function PostFollowupBar({ postId, canSend }: { postId: PostId; canSend: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const audience = useQuery({
    queryKey: ['admin', 'feedback', 'followup', postId],
    queryFn: () => getPostFollowupAudienceFn({ data: { postId } }),
    staleTime: 30_000,
  })

  const send = useMutation({
    mutationFn: () =>
      sendPostFollowupFn({
        data: { postId, message: message.trim(), conversationIds: [...chosen] },
      }),
    onSuccess: (result) => {
      const sent = result.results.filter((row) => row.outcome === 'sent').length
      const unconfirmed = result.results.filter((row) => row.outcome === 'unconfirmed').length
      toast.success(
        unconfirmed > 0 ? `Sent ${sent}, ${unconfirmed} unconfirmed` : `Sent to ${sent}`
      )
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'feedback', 'followup', postId] })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'That could not be sent'),
  })

  const data = audience.data
  if (!data?.sendable || data.recipients.length === 0) return null
  const reachable = data.recipients.filter((row) => row.blocked === null)
  const told = data.recipients.filter((row) => row.blocked === 'already_sent').length

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
      <span className="font-medium">{data.recipients.length} asked for this</span>
      {told > 0 && <span className="text-muted-foreground">{told} already told</span>}
      {canSend && reachable.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          onClick={() => {
            setChosen(new Set(reachable.map((row) => row.conversationId)))
            setOpen(true)
          }}
        >
          Tell them
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send an update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="followup-message">Message</Label>
              <Textarea
                id="followup-message"
                value={message}
                maxLength={2000}
                rows={5}
                placeholder={`We have shipped ${data.postTitle}.`}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {data.recipients.map((row) => (
                <li key={row.conversationId} className="flex items-center gap-3 p-3">
                  <Checkbox
                    id={`followup-${row.conversationId}`}
                    checked={chosen.has(row.conversationId)}
                    disabled={row.blocked !== null}
                    onCheckedChange={(checked) =>
                      setChosen((current) => {
                        const next = new Set(current)
                        if (checked) next.add(row.conversationId)
                        else next.delete(row.conversationId)
                        return next
                      })
                    }
                  />
                  <Label
                    htmlFor={`followup-${row.conversationId}`}
                    className="min-w-0 flex-1 truncate font-normal"
                  >
                    {row.email ?? row.subject ?? 'Conversation'}
                  </Label>
                  {row.blocked && (
                    <span className="text-xs text-muted-foreground">
                      {BLOCKED_NOTE[row.blocked]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={message.trim().length === 0 || chosen.size === 0 || send.isPending}
              onClick={() => send.mutate()}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
