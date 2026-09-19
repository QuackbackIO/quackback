/**
 * Correcting an answer, and keeping the correction (QUINN-PRODUCT Step 11, P8).
 *
 * The correction itself is not new: `recordAnswerCorrection` has always written
 * the right answer down as an approved snippet, so the next customer who asks
 * gets it. What was missing was anywhere to do it from, and the second half the
 * specification asks for: the same correction kept as a regression case, so the
 * fix is proved to still hold the next time the behaviour changes.
 *
 * One control, one dialog, two fields and one choice. The case is offered
 * rather than implied, because a case is run against every future release
 * candidate and a workspace should choose what it is held to.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { Switch } from '@/components/ui/switch'
import { improveAssistantAnswerFn } from '@/lib/server/functions/assistant-improve-answer'

export function QuinnAnswerCorrection({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [idealAnswer, setIdealAnswer] = useState('')
  const [keepAsCase, setKeepAsCase] = useState(true)

  const submit = useMutation({
    mutationFn: () =>
      improveAssistantAnswerFn({
        data: {
          conversationId,
          question: question.trim(),
          idealAnswer: idealAnswer.trim(),
          addRegressionCase: keepAsCase,
        },
      }),
    onSuccess: (result) => {
      toast.success(
        result.regressionCaseId ? 'Saved, and kept as a regression case' : 'Saved for next time'
      )
      setOpen(false)
      setQuestion('')
      setIdealAnswer('')
    },
    onError: (error: Error) => toast.error(error.message || 'The correction could not be saved.'),
  })

  const ready = question.trim().length > 0 && idealAnswer.trim().length > 0

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-1 py-0.5 text-xs"
        onClick={() => setOpen(true)}
      >
        Correct this answer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct this answer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="correction-question">Question</Label>
              <Input
                id="correction-question"
                value={question}
                maxLength={2000}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correction-answer">What Quinn should have said</Label>
              <Textarea
                id="correction-answer"
                rows={5}
                value={idealAnswer}
                maxLength={2000}
                onChange={(event) => setIdealAnswer(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="correction-case">Keep as a regression case</Label>
              <Switch id="correction-case" checked={keepAsCase} onCheckedChange={setKeepAsCase} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
