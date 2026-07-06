import { useState } from 'react'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useSseTurn } from '@/lib/client/hooks/use-sse-turn'
import {
  SANDBOX_EVENTS,
  type SandboxCitation,
  type SandboxEscalation,
  type SandboxFinalPayload,
} from '@/lib/shared/assistant/sandbox-contract'

interface TurnMessage {
  sender: 'customer' | 'assistant'
  content: string
  citations?: SandboxCitation[]
  escalation?: SandboxEscalation | null
}

/**
 * The assistant test sandbox: chat with Quinn against live config without
 * creating any conversation, message, or involvement. Nothing here reaches the
 * inbox.
 */
export function AssistantSandboxCard() {
  const [messages, setMessages] = useState<TurnMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const { start, stop } = useSseTurn()

  const busy = status === 'streaming'

  async function send() {
    const content = input.trim()
    if (!content || busy) return
    setInput('')
    setError(null)

    const thread: TurnMessage[] = [...messages, { sender: 'customer', content }]
    // Optimistically append the empty assistant turn we will stream into.
    setMessages([...thread, { sender: 'assistant', content: '' }])
    setStatus('streaming')

    const patchAssistant = (patch: Partial<TurnMessage>) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.sender === 'assistant') next[next.length - 1] = { ...last, ...patch }
        return next
      })
    }

    let answer = ''

    await start({
      url: '/api/admin/assistant/sandbox',
      body: { messages: thread.map((m) => ({ sender: m.sender, content: m.content })) },
      handlers: {
        [SANDBOX_EVENTS.delta]: (data) => {
          answer += (data as { text: string }).text
          patchAssistant({ content: answer })
        },
        [SANDBOX_EVENTS.final]: (data) => {
          const final = data as SandboxFinalPayload
          patchAssistant({
            content: final.text || answer,
            citations: final.citations ?? [],
            escalation: final.escalation ?? null,
          })
        },
        [SANDBOX_EVENTS.error]: (data) => {
          setError((data as { message: string }).message)
        },
      },
      onHttpError: (res) => {
        const code =
          res.status === 503
            ? 'The assistant is not configured (set an AI model).'
            : 'Request failed.'
        setError(code)
        setStatus('error')
        patchAssistant({ content: '' })
      },
      onStreamEnd: () => setStatus('idle'),
      onError: () => {
        setError('Request failed.')
        setStatus('error')
      },
    })
  }

  function reset() {
    stop()
    setMessages([])
    setInput('')
    setStatus('idle')
    setError(null)
  }

  return (
    <SettingsCard title="Test conversation" description="Messages are not persisted.">
      <div className="space-y-4">
        <div className="min-h-40 space-y-3 rounded-lg border border-border/50 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Send a message as a customer to see how your assistant responds.
            </p>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            placeholder="Ask a question as a customer would"
            rows={2}
            maxLength={4000}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="flex flex-col items-end gap-2">
            <InlineSpinner visible={busy} />
            <Button onClick={() => void send()} disabled={busy || !input.trim()}>
              Send
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

function MessageBubble({ message }: { message: TurnMessage }) {
  const isCustomer = message.sender === 'customer'
  return (
    <div className={isCustomer ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isCustomer
            ? 'max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
            : 'max-w-[80%] space-y-2 rounded-lg bg-muted px-3 py-2 text-sm'
        }
      >
        <p className="whitespace-pre-wrap">{message.content || '…'}</p>
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <a
                key={c.id}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline underline-offset-2"
              >
                {c.title}
              </a>
            ))}
          </div>
        )}
        {message.escalation && (
          <Badge variant="secondary" className="text-xs">
            {message.escalation.mode === 'handoff' ? 'Escalating' : 'Offered a human'}:{' '}
            {message.escalation.reason}
          </Badge>
        )}
      </div>
    </div>
  )
}
