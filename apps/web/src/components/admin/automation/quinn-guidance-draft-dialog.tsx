/**
 * Writing guidance from a conversation that went wrong (QUINN-PRODUCT P8).
 *
 * The other direction of the improvement loop. A regression case says "this
 * must keep working"; this says "behave differently here", and it is the same
 * canonical entry the Guidance page authors, created disabled.
 *
 * Disabled is the whole point of the shape. One bad conversation is evidence,
 * not a decision, and an instruction that took effect the moment somebody
 * pressed a button on a review queue would change how Quinn speaks to everyone
 * without anyone reading it beside the rest of the guidance.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createGuidanceDraftFromConversationFn } from '@/lib/server/functions/assistant-improvement'
import { assistantKeys } from '@/lib/client/queries/assistant'

export function QuinnGuidanceDraftDialog({
  conversationId,
  subject,
}: {
  conversationId: string
  subject: string
}) {
  const cache = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [appliesWhen, setAppliesWhen] = useState('')
  const [body, setBody] = useState('')

  const save = useMutation({
    mutationFn: () =>
      createGuidanceDraftFromConversationFn({
        data: {
          conversationId,
          entry: {
            kind: 'situational',
            title: title.trim() || subject.slice(0, 80),
            appliesWhen: appliesWhen.trim(),
            body: body.trim(),
            uses: ['agent'],
          },
        },
      }),
    onSuccess: () => {
      toast.success('Draft saved. Enable it on Guidance when you are happy with it.')
      void cache.invalidateQueries({ queryKey: assistantKeys.guidanceEntries() })
      setOpen(false)
      setTitle('')
      setAppliesWhen('')
      setBody('')
    },
    onError: (error: Error) => toast.error(error.message || 'The draft could not be saved.'),
  })

  const ready = appliesWhen.trim().length > 0 && body.trim().length > 0

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add guidance
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Guidance from this conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="draft-title">Name</Label>
              <Input
                id="draft-title"
                value={title}
                maxLength={80}
                placeholder={subject.slice(0, 80)}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-when">When it applies</Label>
              <Input
                id="draft-when"
                value={appliesWhen}
                maxLength={1000}
                onChange={(event) => setAppliesWhen(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-body">Instruction</Label>
              <Textarea
                id="draft-body"
                rows={5}
                value={body}
                maxLength={8000}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Saved switched off. Enable it on Guidance to put it in front of Quinn.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
