import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import {
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AssistantAnswer } from '@/components/shared/conversation/assistant-turn'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useAguiTurn } from '@/lib/client/hooks/use-agui-turn'
import {
  ASSISTANT_TEST_AGENTS,
  ASSISTANT_TEST_MAX_CONTENT_CHARS,
  type AssistantTestAgent,
  type AssistantTestChannel,
  type AssistantTestCitation,
  type AssistantTestFinalPayload,
  type AssistantTestTrace,
} from '@/lib/shared/assistant/test-agent-contract'
import type { AssistantIdentity } from '@/lib/shared/assistant/config'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import { cn } from '@/lib/shared/utils'

interface TestTurnMessage {
  id: number
  sender: 'customer' | 'assistant'
  content: string
  citations?: AssistantTestCitation[]
  escalation?: AssistantTestFinalPayload['escalation']
  trace?: AssistantTestTrace
}

interface ParsedHttpError {
  code: string
  message?: string
}

const DEFAULT_IDENTITY: AssistantIdentity = {
  name: 'Quinn',
  avatarUrl: null,
}

const SCENARIOS = [
  {
    id: 'automation.test.scenario.product',
    defaultMessage: 'Ask a product question',
    promptId: 'automation.test.scenario.productPrompt',
    defaultPrompt: 'How does your product work, and which plan would be right for a small team?',
  },
  {
    id: 'automation.test.scenario.problem',
    defaultMessage: 'Report a problem',
    promptId: 'automation.test.scenario.problemPrompt',
    defaultPrompt: 'Something is not working as expected. Can you help me troubleshoot it?',
  },
  {
    id: 'automation.test.scenario.refund',
    defaultMessage: 'Ask for a refund',
    promptId: 'automation.test.scenario.refundPrompt',
    defaultPrompt: 'I would like a refund. What is your refund policy?',
  },
  {
    id: 'automation.test.scenario.human',
    defaultMessage: 'Request a human',
    promptId: 'automation.test.scenario.humanPrompt',
    defaultPrompt: 'I would like to speak with a human, please.',
  },
] as const

function visibleError(
  error: ParsedHttpError,
  formatMessage: ReturnType<typeof useIntl>['formatMessage']
) {
  if (error.code === 'TIER_LIMIT_EXCEEDED') {
    return (
      error.message ??
      formatMessage({
        id: 'automation.test.error.tier',
        defaultMessage: 'This test cannot run because the workspace AI token budget is used up.',
      })
    )
  }
  if (error.code === 'AI_NOT_CONFIGURED') {
    return formatMessage({
      id: 'automation.test.error.notConfigured',
      defaultMessage: 'Choose an AI model before testing the agent.',
    })
  }
  if (error.code === 'INVALID_REQUEST') {
    return formatMessage({
      id: 'automation.test.error.invalid',
      defaultMessage: 'This test conversation is not valid. Reset it and try again.',
    })
  }
  if (error.code === 'FORBIDDEN') {
    return formatMessage({
      id: 'automation.test.error.forbidden',
      defaultMessage: 'You do not have permission to test this agent.',
    })
  }
  return formatMessage({
    id: 'automation.test.error.generic',
    defaultMessage: 'The test run could not be completed. Your message is still here.',
  })
}

export function TestAgentCard({
  liveChannels = ['widget'],
  initialAgent = 'agent',
}: {
  liveChannels?: readonly AssistantTestChannel[]
  initialAgent?: AssistantTestAgent
}) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const identity = settingsQuery.data?.config.identity ?? DEFAULT_IDENTITY
  const channels = liveChannels.length > 0 ? liveChannels : (['widget'] as const)
  const [channel, setChannel] = useState<AssistantTestChannel>(channels[0])
  const [agent, setAgent] = useState<AssistantTestAgent>(initialAgent)
  const [messages, setMessages] = useState<TestTurnMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle')
  const [activity, setActivity] = useState<AssistantActivityStatus>('thinking')
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const nextId = useRef(1)
  const { start, stop, clear, rewindToTurn } = useAguiTurn({ url: '/api/admin/assistant/test' })
  const busy = status === 'streaming'

  useEffect(() => stop, [stop])

  async function send() {
    const content = input.trim()
    if (!content || busy) return

    const customerId = nextId.current++
    const assistantId = nextId.current++
    // How many customer turns precede this one — the native AG-UI thread index
    // to rewind to if this turn fails, so a Retry re-asks cleanly instead of
    // leaving the failed question in the model's history.
    const turnIndex = messages.filter((message) => message.sender === 'customer').length
    let answer = ''
    let failed = false
    let finalized = false

    setMessages((current) => [
      ...current,
      { id: customerId, sender: 'customer', content },
      { id: assistantId, sender: 'assistant', content: '' },
    ])
    setInput('')
    setError(null)
    setActivity('thinking')
    setStatus('streaming')
    setAnnouncement(
      intl.formatMessage({ id: 'automation.test.working', defaultMessage: 'Agent is working.' })
    )

    const patchAssistant = (patch: Partial<TestTurnMessage>) => {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message))
      )
    }
    const fail = (message: string) => {
      if (failed || finalized) return
      failed = true
      rewindToTurn(turnIndex)
      setMessages((current) =>
        current.filter((item) => item.id !== customerId && item.id !== assistantId)
      )
      setInput(content)
      setError(message)
      setStatus('error')
      setAnnouncement(message)
    }

    // History rides the native AG-UI thread (useChat re-sends its accumulated
    // messages); only the two sandbox selectors travel on forwardedProps.
    await start({
      question: content,
      forwardedProps: { channel, agent },
      handlers: {
        onActivity: (next) => {
          setActivity(next)
          setAnnouncement(activityLabel(next, intl.formatMessage))
        },
        onTextDelta: (_delta, fullText) => {
          answer = fullText
          patchAssistant({ content: answer })
        },
        onFinal: (payload) => {
          const final = payload as AssistantTestFinalPayload
          finalized = true
          patchAssistant({
            content: final.text || answer,
            citations: final.citations,
            escalation: final.escalation,
            trace: final.trace,
          })
          setStatus('idle')
          setAnnouncement(
            intl.formatMessage({
              id: 'automation.test.complete',
              defaultMessage: 'Reply complete.',
            })
          )
        },
        // A RUN_ERROR carries the server's coded message; an HTTP gate failure
        // (tier limit, not configured) surfaces its envelope message via the
        // hook's fetch wrapper. Fall back to the localized generic when a bare
        // transport failure carries nothing usable.
        onError: (message) =>
          fail(message || visibleError({ code: 'NETWORK_ERROR' }, intl.formatMessage)),
        onStreamEnd: () => {
          if (!failed && !finalized) {
            fail(visibleError({ code: 'STREAM_ENDED' }, intl.formatMessage))
          }
        },
      },
    })
  }

  function reset() {
    stop()
    clear()
    setMessages([])
    setInput('')
    setStatus('idle')
    setError(null)
    setActivity('thinking')
    setAnnouncement(
      intl.formatMessage({ id: 'automation.test.resetDone', defaultMessage: 'Conversation reset.' })
    )
  }

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.test.conversation.title',
        defaultMessage: 'Test conversation',
      })}
      description={intl.formatMessage({
        id: 'automation.test.conversation.description',
        defaultMessage: 'Replies use the saved production configuration and simulated actions.',
      })}
      contentClassName="space-y-5"
    >
      <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          {intl.formatMessage({
            id: 'automation.test.noCustomerAffected',
            defaultMessage:
              'No customer is affected. Nothing is sent, saved to the inbox, or carried out.',
          })}
        </p>
      </div>

      <section aria-labelledby="test-agent-scenarios" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="test-agent-scenarios" className="text-sm font-medium">
            {intl.formatMessage({
              id: 'automation.test.scenario.label',
              defaultMessage: 'Try a scenario',
            })}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.test.agent.label',
                  defaultMessage: 'Agent',
                })}
              </span>
              <Select
                value={agent}
                disabled={busy}
                onValueChange={(value) => setAgent(value as AssistantTestAgent)}
              >
                <SelectTrigger
                  size="sm"
                  className="min-h-11 min-w-32 sm:min-h-8"
                  aria-label={intl.formatMessage({
                    id: 'automation.test.agent.label',
                    defaultMessage: 'Agent',
                  })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSISTANT_TEST_AGENTS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {intl.formatMessage({
                        id: `automation.test.agent.${item}`,
                        defaultMessage: item === 'copilot' ? 'Copilot' : 'Agent',
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {agent === 'agent' && channels.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.test.channel.label',
                    defaultMessage: 'Channel',
                  })}
                </span>
                <Select
                  value={channel}
                  onValueChange={(value) => setChannel(value as AssistantTestChannel)}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-h-11 min-w-32 sm:min-h-8"
                    aria-label={intl.formatMessage({
                      id: 'automation.test.channel.label',
                      defaultMessage: 'Channel',
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {intl.formatMessage({
                          id: `automation.test.channel.${item}`,
                          defaultMessage: item === 'widget' ? 'Messenger' : 'Email',
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <Button
              key={scenario.id}
              type="button"
              variant="outline"
              className="min-h-11 h-auto justify-start whitespace-normal py-2 text-start"
              disabled={busy}
              onClick={() =>
                setInput(
                  intl.formatMessage({
                    id: scenario.promptId,
                    defaultMessage: scenario.defaultPrompt,
                  })
                )
              }
            >
              {intl.formatMessage({ id: scenario.id, defaultMessage: scenario.defaultMessage })}
            </Button>
          ))}
        </div>
      </section>

      <section
        aria-label={intl.formatMessage({
          id: 'automation.test.transcript',
          defaultMessage: 'Test conversation',
        })}
        className="min-h-44 space-y-4 rounded-xl border border-border/60 bg-background p-3 sm:p-4"
      >
        {messages.length === 0 ? (
          <div className="py-6">
            <div className="flex items-center gap-2">
              <Avatar
                src={identity.avatarUrl}
                name={identity.name}
                className="size-7 text-[11px]"
              />
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <SparklesIcon className="size-3.5" aria-hidden />
                {identity.name}{' '}
                {intl.formatMessage({ id: 'automation.test.aiLabel', defaultMessage: 'AI' })}
              </span>
            </div>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.test.empty',
                defaultMessage: 'Choose a scenario or ask a question as a customer would.',
              })}
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <TestMessage
              key={message.id}
              message={message}
              identity={identity}
              working={busy && message.id === messages.at(-1)?.id}
              activity={activity}
            />
          ))
        )}
      </section>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {error && (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full shrink-0 sm:min-h-9 sm:w-auto"
            disabled={!input.trim()}
            onClick={() => void send()}
          >
            <ArrowPathIcon className="size-4" aria-hidden />
            {intl.formatMessage({ id: 'automation.test.retry', defaultMessage: 'Retry' })}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="test-agent-message" className="sr-only">
          {intl.formatMessage({
            id: 'automation.test.input.label',
            defaultMessage: 'Customer message',
          })}
        </label>
        <Textarea
          id="test-agent-message"
          value={input}
          placeholder={intl.formatMessage({
            id: 'automation.test.input.placeholder',
            defaultMessage: 'Ask a question as a customer would',
          })}
          rows={3}
          maxLength={ASSISTANT_TEST_MAX_CONTENT_CHARS}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            disabled={messages.length === 0 && !input && !error}
            onClick={reset}
          >
            {intl.formatMessage({
              id: 'automation.test.reset',
              defaultMessage: 'Reset conversation',
            })}
          </Button>
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
            <PaperAirplaneIcon className="size-4" aria-hidden />
            {intl.formatMessage({ id: 'automation.test.send', defaultMessage: 'Send' })}
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}

function activityLabel(
  activity: AssistantActivityStatus,
  formatMessage: ReturnType<typeof useIntl>['formatMessage']
): string {
  if (activity === 'searching_kb') {
    return formatMessage({
      id: 'automation.test.activity.searching',
      defaultMessage: 'Searching the knowledge base.',
    })
  }
  if (activity === 'reviewing_conversation') {
    return formatMessage({
      id: 'automation.test.activity.reviewing',
      defaultMessage: 'Reviewing the conversation.',
    })
  }
  return formatMessage({ id: 'automation.test.working', defaultMessage: 'Agent is working.' })
}

function TestMessage({
  message,
  identity,
  working,
  activity,
}: {
  message: TestTurnMessage
  identity: AssistantIdentity
  working: boolean
  activity: AssistantActivityStatus
}) {
  const intl = useIntl()
  if (message.sender === 'customer') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-ee-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground sm:max-w-[78%]">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Avatar src={identity.avatarUrl} name={identity.name} className="size-7 text-[11px]" />
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <SparklesIcon className="size-3.5" aria-hidden />
          {identity.name}{' '}
          {intl.formatMessage({ id: 'automation.test.aiLabel', defaultMessage: 'AI' })}
        </span>
      </div>
      <div className="max-w-[92%] rounded-2xl rounded-es-md bg-muted px-3.5 py-2.5 text-foreground sm:max-w-[82%]">
        {message.content ? (
          <AssistantAnswer
            text={message.content}
            citations={message.citations ?? []}
            caret={working}
          />
        ) : working ? (
          <div className="flex items-center gap-2 py-0.5 text-[13px] text-muted-foreground">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground"
              aria-hidden
            />
            <span>{activityLabel(activity, intl.formatMessage)}</span>
          </div>
        ) : null}
      </div>
      {message.trace && (
        <HandledReplyPanel
          trace={message.trace}
          citations={message.citations ?? []}
          escalation={message.escalation ?? null}
        />
      )}
    </div>
  )
}

function HandledReplyPanel({
  trace,
  citations,
  escalation,
}: {
  trace: AssistantTestTrace
  citations: AssistantTestCitation[]
  escalation: AssistantTestFinalPayload['escalation']
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'prompt' | 'config' | null>(null)
  const actions = trace.toolCalls.filter(
    ({ name }) => name !== 'search' && name !== 'handoff_to_human'
  )
  const searched = trace.toolCalls.some(({ name }) => name === 'search')

  async function copy(value: string, field: 'prompt' | 'config') {
    await navigator.clipboard?.writeText(value)
    setCopied(field)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="max-w-2xl">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
        >
          <ChevronDownIcon
            className={cn(
              'size-3.5 transition-transform motion-reduce:transition-none',
              open && 'rotate-180'
            )}
            aria-hidden
          />
          {intl.formatMessage({
            id: 'automation.test.handled.title',
            defaultMessage: 'How this reply was handled',
          })}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 text-[13px]">
          {trace.tone && trace.responseLength ? (
            <DetailSection
              title={intl.formatMessage({
                id: 'automation.test.handled.presets',
                defaultMessage: 'Reply presets',
              })}
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" shape="pill">
                  {intl.formatMessage({
                    id: `automation.agent.voice.tone.${trace.tone}.label`,
                    defaultMessage: titleCase(trace.tone),
                  })}
                </Badge>
                <Badge variant="outline" shape="pill">
                  {intl.formatMessage({
                    id: `automation.agent.voice.length.${trace.responseLength}.label`,
                    defaultMessage: titleCase(trace.responseLength),
                  })}
                </Badge>
              </div>
            </DetailSection>
          ) : null}

          <DetailSection
            title={intl.formatMessage({
              id: 'automation.test.handled.guidance',
              defaultMessage: 'Applied guidance',
            })}
          >
            {trace.appliedGuidance.length > 0 ? (
              <ul className="list-disc space-y-1 ps-4">
                {trace.appliedGuidance.map((guidance) => (
                  <li key={guidance.id}>{guidance.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.test.handled.guidance.none',
                  defaultMessage: 'No situational guidance applied.',
                })}
              </p>
            )}
          </DetailSection>

          <DetailSection
            title={intl.formatMessage({
              id: 'automation.test.handled.sources',
              defaultMessage: 'Knowledge sources',
            })}
          >
            {citations.length > 0 ? (
              <ul className="space-y-1.5">
                {citations.map((citation) => (
                  <li key={citation.id}>
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {citation.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {searched
                  ? intl.formatMessage({
                      id: 'automation.test.handled.sources.uncited',
                      defaultMessage: 'Knowledge was searched, but no source was cited.',
                    })
                  : intl.formatMessage({
                      id: 'automation.test.handled.sources.none',
                      defaultMessage: 'No knowledge sources were needed.',
                    })}
              </p>
            )}
          </DetailSection>

          <DetailSection
            title={intl.formatMessage({
              id: 'automation.test.handled.actions',
              defaultMessage: 'Actions',
            })}
          >
            {actions.length > 0 ? (
              <ul className="space-y-1.5">
                {actions.map((action, index) => (
                  <li key={`${action.name}-${index}`} className="flex items-center gap-2">
                    <span>{titleCase(action.name)}</span>
                    <Badge size="sm" variant="secondary" shape="pill">
                      {intl.formatMessage({
                        id: `automation.test.handled.action.${action.outcome}`,
                        defaultMessage: titleCase(action.outcome),
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.test.handled.actions.none',
                  defaultMessage: 'No customer action would be carried out.',
                })}
              </p>
            )}
          </DetailSection>

          <DetailSection
            title={intl.formatMessage({
              id: 'automation.test.handled.handoff',
              defaultMessage: 'Handoff',
            })}
          >
            <p className={escalation ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {escalation
                ? intl.formatMessage({
                    id: 'automation.test.handled.handoff.yes',
                    defaultMessage: 'A handoff would occur in a real conversation.',
                  })
                : intl.formatMessage({
                    id: 'automation.test.handled.handoff.no',
                    defaultMessage: 'No handoff would occur.',
                  })}
            </p>
            {escalation && (
              <p className="mt-1 text-muted-foreground">
                {handoffReason(escalation.reason, intl.formatMessage)}
              </p>
            )}
          </DetailSection>

          <details className="border-t border-border/60 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9">
              {intl.formatMessage({
                id: 'automation.test.handled.technical',
                defaultMessage: 'Technical details',
              })}
            </summary>
            <dl className="space-y-2 pt-2">
              <TechnicalValue
                label={intl.formatMessage({
                  id: 'automation.test.handled.promptVersion',
                  defaultMessage: 'Prompt version',
                })}
                value={trace.promptVersion}
                copied={copied === 'prompt'}
                onCopy={() => void copy(trace.promptVersion, 'prompt')}
              />
              <TechnicalValue
                label={intl.formatMessage({
                  id: 'automation.test.handled.configRevision',
                  defaultMessage: 'Configuration revision',
                })}
                value={String(trace.configRevision)}
                copied={copied === 'config'}
                onCopy={() => void copy(String(trace.configRevision), 'config')}
              />
            </dl>
          </details>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  )
}

function TechnicalValue({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
}) {
  const intl = useIntl()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="select-all truncate font-mono text-xs">{value}</dd>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
        aria-label={intl.formatMessage(
          {
            id: copied ? 'automation.test.handled.copied' : 'automation.test.handled.copy',
            defaultMessage: copied ? 'Copied {label}' : 'Copy {label}',
          },
          { label }
        )}
        onClick={onCopy}
      >
        {copied ? <CheckIcon className="size-4" /> : <ClipboardDocumentIcon className="size-4" />}
      </Button>
    </div>
  )
}

function handoffReason(
  reason: string,
  formatMessage: ReturnType<typeof useIntl>['formatMessage']
): string {
  const labels: Record<string, { id: string; defaultMessage: string }> = {
    explicit_request: {
      id: 'automation.test.handoffReason.explicitRequest',
      defaultMessage: 'The customer asked for a person.',
    },
    frustration: {
      id: 'automation.test.handoffReason.frustration',
      defaultMessage: 'The customer appeared frustrated.',
    },
    repetition: {
      id: 'automation.test.handoffReason.repetition',
      defaultMessage: 'The customer repeated the issue.',
    },
    low_confidence: {
      id: 'automation.test.handoffReason.lowConfidence',
      defaultMessage: 'The agent was not confident it could resolve the request.',
    },
    safety: {
      id: 'automation.test.handoffReason.safety',
      defaultMessage: 'The request requires human judgment for safety.',
    },
  }
  const label = labels[reason]
  return label ? formatMessage(label) : titleCase(reason)
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
