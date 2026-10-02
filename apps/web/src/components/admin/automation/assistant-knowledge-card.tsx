import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  useUpdateAssistantAgentKnowledge,
  useUpdateAssistantCopilotKnowledge,
} from '@/lib/client/mutations/assistant'
import {
  ASSISTANT_AGENT_KNOWLEDGE_SOURCES,
  ASSISTANT_COPILOT_KNOWLEDGE_SOURCES,
  type AssistantAgentKnowledge,
  type AssistantCopilotKnowledge,
} from '@/lib/shared/assistant/config'
import { isAssistantFieldManaged, useUnsavedChanges } from './assistant-form'
import { useAssistantSave } from './assistant-save-queue'

/**
 * Every knowledge source's admin label, help text, and readiness live in one
 * map (C2-style single vocabulary site). `readiness` distinguishes how a source
 * grounds: 'ready' sources are retrieval-indexed and carry no badge; 'live' is
 * the status source, a real-time `get_status` lookup rather than an index, and
 * is the one source that says so. Feedback posts carry a per-agent description
 * because the Agent only ever sees public boards (D8), cited as customer
 * feedback.
 */
const SOURCE_META = {
  helpCenter: {
    labelId: 'automation.knowledge.source.helpCenter.label',
    label: 'Help center',
    descriptionId: 'automation.knowledge.source.helpCenter.description',
    description: 'Published Help Center articles.',
    readiness: 'ready',
  },
  posts: {
    labelId: 'automation.knowledge.source.posts.label',
    label: 'Feedback posts',
    descriptionId: 'automation.knowledge.source.posts.description',
    description: 'Feedback posts and their discussion.',
    readiness: 'ready',
  },
  pastConversations: {
    labelId: 'automation.knowledge.source.pastConversations.label',
    label: 'Past conversations',
    descriptionId: 'automation.knowledge.source.pastConversations.description',
    description: 'Earlier conversations with the same customer.',
    readiness: 'ready',
  },
  internalNotes: {
    labelId: 'automation.knowledge.source.internalNotes.label',
    label: 'Internal notes',
    descriptionId: 'automation.knowledge.source.internalNotes.description',
    description: 'Private teammate notes on the conversation. Never used in drafts.',
    readiness: 'ready',
  },
  tickets: {
    labelId: 'automation.knowledge.source.tickets.label',
    label: 'Tickets',
    descriptionId: 'automation.knowledge.source.tickets.description',
    description: 'Resolution summaries from closed tickets.',
    readiness: 'ready',
  },
  changelog: {
    labelId: 'automation.knowledge.source.changelog.label',
    label: 'Changelog',
    descriptionId: 'automation.knowledge.source.changelog.description',
    description: 'Published changelog entries.',
    readiness: 'ready',
  },
  documents: {
    labelId: 'automation.knowledge.source.documents.label',
    label: 'Documents',
    descriptionId: 'automation.knowledge.source.documents.description',
    description: 'Uploaded knowledge documents (PDFs).',
    readiness: 'ready',
  },
  status: {
    labelId: 'automation.knowledge.source.status.label',
    label: 'System status',
    descriptionId: 'automation.knowledge.source.status.description',
    description: 'Live status components, incidents, and maintenance windows.',
    readiness: 'live',
  },
} as const satisfies Record<
  string,
  {
    labelId: string
    label: string
    descriptionId: string
    description: string
    readiness: 'ready' | 'live'
  }
>

const AGENT_POSTS_DESCRIPTION = {
  id: 'automation.knowledge.source.posts.agentDescription',
  defaultMessage: 'Public feedback boards only, cited as customer feedback.',
}

interface KnowledgeRow {
  source: string
  enabled: boolean
  managed: boolean
  descriptionOverride?: { id: string; defaultMessage: string }
}

function LiveLookupBadge() {
  const intl = useIntl()
  return (
    <Badge size="sm" variant="outline">
      {intl.formatMessage({
        id: 'automation.knowledge.readiness.live',
        defaultMessage: 'Live lookup',
      })}
    </Badge>
  )
}

/** Shared presentation for both agents; the caller owns typed persistence. */
function KnowledgeCard({
  rows,
  busy,
  onToggle,
}: {
  rows: KnowledgeRow[]
  busy: boolean
  onToggle: (source: string, next: boolean) => void
}) {
  const intl = useIntl()
  return (
    <SettingsCard>
      <SettingRows>
        {rows.map((row) => {
          const meta = SOURCE_META[row.source as keyof typeof SOURCE_META]
          const switchId = `knowledge-${row.source}`
          const label = intl.formatMessage({ id: meta.labelId, defaultMessage: meta.label })
          return (
            <SettingRow
              key={row.source}
              htmlFor={switchId}
              label={label}
              badge={meta.readiness === 'live' ? <LiveLookupBadge /> : undefined}
              description={
                <>
                  {intl.formatMessage(
                    row.descriptionOverride ?? {
                      id: meta.descriptionId,
                      defaultMessage: meta.description,
                    }
                  )}
                  {row.managed && (
                    <span className="block">
                      {intl.formatMessage({
                        id: 'automation.agent.managed',
                        defaultMessage: 'This setting is managed by your deployment configuration.',
                      })}
                    </span>
                  )}
                </>
              }
              control={
                <Switch
                  id={switchId}
                  checked={row.enabled}
                  disabled={row.managed || busy}
                  onCheckedChange={(next) => onToggle(row.source, next)}
                  aria-label={intl.formatMessage(
                    { id: 'automation.knowledge.toggleAria', defaultMessage: 'Use {source}' },
                    { source: label }
                  )}
                />
              }
            />
          )
        })}
      </SettingRows>
    </SettingsCard>
  )
}

function KnowledgeLoading() {
  const intl = useIntl()
  return (
    <SettingsCard>
      <p role="status" className="text-sm text-muted-foreground">
        {intl.formatMessage({
          id: 'automation.agent.loading',
          defaultMessage: 'Loading AI agent settings…',
        })}
      </p>
    </SettingsCard>
  )
}

function KnowledgeError({ onRetry }: { onRetry: () => void }) {
  const intl = useIntl()
  return (
    <SettingsCard>
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {intl.formatMessage({
            id: 'automation.agent.loadError',
            defaultMessage: 'AI agent settings could not be loaded.',
          })}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
        </Button>
      </div>
    </SettingsCard>
  )
}

export function AgentKnowledgeCard() {
  const settingsQuery = useQuery(assistantQueries.settings())
  const queryClient = useQueryClient()
  const saveQueued = useAssistantSave()
  const update = useUpdateAssistantAgentKnowledge()
  const [pending, setPending] = useState(0)
  useUnsavedChanges(pending > 0, 'knowledge')
  const [knowledge, setKnowledge] = useState<AssistantAgentKnowledge | null>(null)

  useEffect(() => {
    if (settingsQuery.data && pending === 0) {
      setKnowledge(settingsQuery.data.config.agents.agent.knowledge)
    }
  }, [settingsQuery.data, pending])

  if (settingsQuery.isError) return <KnowledgeError onRetry={() => void settingsQuery.refetch()} />
  if (!knowledge || settingsQuery.isPending) return <KnowledgeLoading />

  const managedPaths = settingsQuery.data.managedFieldPaths
  const rows: KnowledgeRow[] = ASSISTANT_AGENT_KNOWLEDGE_SOURCES.map((source) => ({
    source,
    enabled: knowledge[source],
    managed: isAssistantFieldManaged(managedPaths, `agents.agent.knowledge.${source}`),
    descriptionOverride: source === 'posts' ? AGENT_POSTS_DESCRIPTION : undefined,
  }))

  async function toggle(source: string, next: boolean) {
    const key = source as keyof AssistantAgentKnowledge
    // A computed-key spread widens the known keys to optional, so re-assert the
    // exact source shape (every field is a boolean the schema re-validates).
    setKnowledge((current) => current && ({ ...current, [key]: next } as AssistantAgentKnowledge))
    setPending((count) => count + 1)
    try {
      // Built on the latest saved knowledge, so toggles and other saves made
      // before this one runs are kept.
      await saveQueued((latest) =>
        update.mutateAsync({
          expectedRevision: latest.revision,
          knowledge: {
            ...latest.config.agents.agent.knowledge,
            [key]: next,
          } as AssistantAgentKnowledge,
        })
      )
    } catch {
      // The autosave handler shows the failure toast and a stale revision is
      // refetched by the queue; show what is actually saved.
      const latest = queryClient.getQueryData(assistantQueries.settings().queryKey)
      if (latest) setKnowledge(latest.config.agents.agent.knowledge)
    } finally {
      setPending((count) => count - 1)
    }
  }

  return (
    <KnowledgeCard rows={rows} busy={update.isPending} onToggle={(s, n) => void toggle(s, n)} />
  )
}

export function CopilotKnowledgeCard() {
  const settingsQuery = useQuery(assistantQueries.settings())
  const queryClient = useQueryClient()
  const saveQueued = useAssistantSave()
  const update = useUpdateAssistantCopilotKnowledge()
  const [pending, setPending] = useState(0)
  useUnsavedChanges(pending > 0, 'knowledge')
  const [knowledge, setKnowledge] = useState<AssistantCopilotKnowledge | null>(null)

  useEffect(() => {
    if (settingsQuery.data && pending === 0) {
      setKnowledge(settingsQuery.data.config.agents.copilot.knowledge)
    }
  }, [settingsQuery.data, pending])

  if (settingsQuery.isError) return <KnowledgeError onRetry={() => void settingsQuery.refetch()} />
  if (!knowledge || settingsQuery.isPending) return <KnowledgeLoading />

  const managedPaths = settingsQuery.data.managedFieldPaths
  const rows: KnowledgeRow[] = ASSISTANT_COPILOT_KNOWLEDGE_SOURCES.map((source) => ({
    source,
    enabled: knowledge[source],
    managed: isAssistantFieldManaged(managedPaths, `agents.copilot.knowledge.${source}`),
  }))

  async function toggle(source: string, next: boolean) {
    const key = source as keyof AssistantCopilotKnowledge
    // A computed-key spread widens the known keys to optional, so re-assert the
    // exact source shape (every field is a boolean the schema re-validates).
    setKnowledge((current) => current && ({ ...current, [key]: next } as AssistantCopilotKnowledge))
    setPending((count) => count + 1)
    try {
      // Built on the latest saved knowledge, so toggles and other saves made
      // before this one runs are kept.
      await saveQueued((latest) =>
        update.mutateAsync({
          expectedRevision: latest.revision,
          knowledge: {
            ...latest.config.agents.copilot.knowledge,
            [key]: next,
          } as AssistantCopilotKnowledge,
        })
      )
    } catch {
      // The autosave handler shows the failure toast and a stale revision is
      // refetched by the queue; show what is actually saved.
      const latest = queryClient.getQueryData(assistantQueries.settings().queryKey)
      if (latest) setKnowledge(latest.config.agents.copilot.knowledge)
    } finally {
      setPending((count) => count - 1)
    }
  }

  return (
    <KnowledgeCard rows={rows} busy={update.isPending} onToggle={(s, n) => void toggle(s, n)} />
  )
}
