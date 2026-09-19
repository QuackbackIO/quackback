/**
 * The candidate sandbox: ask Quinn something and see what this exact candidate
 * would say (QUINN-PRODUCT P7).
 *
 * It grounds on no conversation, so nothing here reaches the inbox and every
 * write previews instead of running. With release management on there are two
 * targets, the reviewed candidate and what is live, so the same question can be
 * asked of both; with it off there is only one behaviour and no selector.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useRunAssistantSandboxTurn } from '@/lib/client/mutations/assistant'

interface Exchange {
  question: string
  answer: string
  status: 'answered' | 'cannot_answer' | 'suppressed'
  target: 'candidate' | 'live'
  tools: Array<{ name: string; outcome: string }>
  citations: number
}

export function QuinnSandbox() {
  const state = useQuery(assistantQueries.releaseState())
  const run = useRunAssistantSandboxTurn()
  const [question, setQuestion] = useState('')
  const [target, setTarget] = useState<'candidate' | 'live'>('candidate')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const managed = state.data?.managementEnabled === true
  const configured = state.data?.configured !== false

  async function ask() {
    const asked = question.trim()
    if (!asked) return
    setFailure(null)
    try {
      const turn = await run.mutateAsync({
        messages: [{ sender: 'customer', content: asked }],
        target: managed ? target : 'live',
      })
      setExchanges((current) => [
        ...current,
        {
          question: asked,
          answer: turn.text,
          status: turn.status,
          target: managed ? target : 'live',
          tools: turn.tools,
          citations: turn.citations.length,
        },
      ])
      setQuestion('')
    } catch {
      setFailure('That turn could not be completed.')
    }
  }

  return (
    <section className="space-y-3">
      {!configured && (
        <p role="status" className="rounded-xl border p-4 text-sm text-muted-foreground">
          Configure an AI model before Quinn can answer.
        </p>
      )}
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        {managed && (
          <div className="flex gap-2">
            {(['candidate', 'live'] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={target === option ? 'secondary' : 'outline'}
                onClick={() => setTarget(option)}
              >
                {option === 'candidate' ? 'Draft' : 'Live'}
              </Button>
            ))}
          </div>
        )}
        <ul className="space-y-3">
          {exchanges.map((exchange, index) => (
            <li key={index} className="space-y-1 text-sm">
              <p className="font-medium">{exchange.question}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{exchange.answer}</p>
              <div className="flex flex-wrap items-center gap-2">
                {managed && (
                  <Badge variant="outline">{exchange.target === 'live' ? 'Live' : 'Draft'}</Badge>
                )}
                {exchange.status !== 'answered' && (
                  <Badge variant="outline">{exchange.status.replace('_', ' ')}</Badge>
                )}
                {exchange.citations > 0 && (
                  <Badge variant="outline">{exchange.citations} sources</Badge>
                )}
                {exchange.tools.map((tool) => (
                  <Badge key={`${tool.name}-${tool.outcome}`} variant="outline">
                    {tool.name}: {tool.outcome}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask Quinn something a customer would ask"
          rows={2}
          disabled={!configured}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={ask} disabled={run.isPending || !configured}>
            Ask
          </Button>
          <span className="text-xs text-muted-foreground">
            Nothing here reaches the inbox and no action runs for real.
          </span>
        </div>
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
      </div>
    </section>
  )
}
