import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Link } from '@tanstack/react-router'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { QuinnKnowledgeSources } from './quinn-knowledge-sources'
import { QuinnArticleHealth } from './quinn-article-health'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
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
import { isAssistantFieldManaged, ManagedSettingHint } from './assistant-form'

/**
 * Every knowledge source's admin label, help text, and readiness live in one
 * map (C2-style single vocabulary site). `readiness` distinguishes how a source
 * grounds: 'ready' sources are retrieval-indexed; 'live' is the status source,
 * a real-time `get_status` lookup rather than an index. Feedback posts carry a
 * per-agent description because the Agent only ever sees public boards (D8),
 * cited as customer feedback.
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
  webPages: {
    labelId: 'automation.knowledge.source.webPages.label',
    label: 'Web pages',
    descriptionId: 'automation.knowledge.source.webPages.description',
    description: 'Public pages added by your team.',
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

function ReadinessChip({ readiness }: { readiness: 'ready' | 'live' }) {
  const intl = useIntl()
  if (readiness === 'live') {
    return (
      <Badge size="sm" variant="outline" shape="pill">
        {intl.formatMessage({
          id: 'automation.knowledge.readiness.live',
          defaultMessage: 'Live lookup',
        })}
      </Badge>
    )
  }
  return (
    <Badge size="sm" variant="secondary" shape="pill">
      {intl.formatMessage({ id: 'automation.knowledge.readiness.ready', defaultMessage: 'Ready' })}
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
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.knowledge.title',
        defaultMessage: 'Knowledge sources',
      })}
      description={intl.formatMessage({
        id: 'automation.knowledge.description',
        defaultMessage: 'Choose what Quinn is allowed to draw on when it answers.',
      })}
    >
      <div className="space-y-4">
        <div className="divide-y divide-border/60">
          {rows.map((row) => {
            const meta = SOURCE_META[row.source as keyof typeof SOURCE_META]
            const switchId = `knowledge-${row.source}`
            return (
              <div key={row.source} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={switchId} className="text-sm font-medium">
                      {intl.formatMessage({ id: meta.labelId, defaultMessage: meta.label })}
                    </label>
                    <ReadinessChip readiness={meta.readiness} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {intl.formatMessage(
                      row.descriptionOverride ?? {
                        id: meta.descriptionId,
                        defaultMessage: meta.description,
                      }
                    )}
                  </p>
                  {row.managed && <ManagedSettingHint />}
                </div>
                <Switch
                  id={switchId}
                  checked={row.enabled}
                  disabled={row.managed || busy}
                  onCheckedChange={(next) => onToggle(row.source, next)}
                  aria-label={intl.formatMessage(
                    { id: 'automation.knowledge.toggleAria', defaultMessage: 'Use {source}' },
                    {
                      source: intl.formatMessage({ id: meta.labelId, defaultMessage: meta.label }),
                    }
                  )}
                />
              </div>
            )
          })}
        </div>
      </div>
    </SettingsCard>
  )
}

function KnowledgeLoading() {
  const intl = useIntl()
  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.knowledge.title',
        defaultMessage: 'Knowledge sources',
      })}
    >
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
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.knowledge.title',
        defaultMessage: 'Knowledge sources',
      })}
    >
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
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const update = useUpdateAssistantAgentKnowledge()
  const [knowledge, setKnowledge] = useState<AssistantAgentKnowledge | null>(null)

  useEffect(() => {
    if (settingsQuery.data && !update.isPending) {
      setKnowledge(settingsQuery.data.config.agents.agent.knowledge)
    }
  }, [settingsQuery.data, update.isPending])

  if (settingsQuery.isError) return <KnowledgeError onRetry={() => void settingsQuery.refetch()} />
  if (!knowledge || settingsQuery.isPending) return <KnowledgeLoading />

  const managedPaths = settingsQuery.data.managedFieldPaths
  const revision = settingsQuery.data.revision
  const rows: KnowledgeRow[] = ASSISTANT_AGENT_KNOWLEDGE_SOURCES.map((source) => ({
    source,
    enabled: knowledge[source],
    managed: isAssistantFieldManaged(managedPaths, `agents.agent.knowledge.${source}`),
    descriptionOverride: source === 'posts' ? AGENT_POSTS_DESCRIPTION : undefined,
  }))

  async function toggle(source: string, next: boolean) {
    const key = source as keyof AssistantAgentKnowledge
    const previous = knowledge
    // A computed-key spread widens the known keys to optional, so re-assert the
    // exact source shape (every field is a boolean the schema re-validates).
    const optimistic = { ...knowledge, [key]: next } as AssistantAgentKnowledge
    setKnowledge(optimistic)
    try {
      await update.mutateAsync({ expectedRevision: revision, knowledge: optimistic })
    } catch {
      setKnowledge(previous)
      toast.error(
        intl.formatMessage({
          id: 'automation.knowledge.saveError',
          defaultMessage: 'Knowledge sources could not be updated.',
        })
      )
    }
  }

  return (
    <KnowledgeCard rows={rows} busy={update.isPending} onToggle={(s, n) => void toggle(s, n)} />
  )
}

export function CopilotKnowledgeCard() {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const update = useUpdateAssistantCopilotKnowledge()
  const [knowledge, setKnowledge] = useState<AssistantCopilotKnowledge | null>(null)

  useEffect(() => {
    if (settingsQuery.data && !update.isPending) {
      setKnowledge(settingsQuery.data.config.agents.copilot.knowledge)
    }
  }, [settingsQuery.data, update.isPending])

  if (settingsQuery.isError) return <KnowledgeError onRetry={() => void settingsQuery.refetch()} />
  if (!knowledge || settingsQuery.isPending) return <KnowledgeLoading />

  const managedPaths = settingsQuery.data.managedFieldPaths
  const revision = settingsQuery.data.revision
  const rows: KnowledgeRow[] = ASSISTANT_COPILOT_KNOWLEDGE_SOURCES.map((source) => ({
    source,
    enabled: knowledge[source],
    managed: isAssistantFieldManaged(managedPaths, `agents.copilot.knowledge.${source}`),
  }))

  async function toggle(source: string, next: boolean) {
    const key = source as keyof AssistantCopilotKnowledge
    const previous = knowledge
    // A computed-key spread widens the known keys to optional, so re-assert the
    // exact source shape (every field is a boolean the schema re-validates).
    const optimistic = { ...knowledge, [key]: next } as AssistantCopilotKnowledge
    setKnowledge(optimistic)
    try {
      await update.mutateAsync({ expectedRevision: revision, knowledge: optimistic })
    } catch {
      setKnowledge(previous)
      toast.error(
        intl.formatMessage({
          id: 'automation.knowledge.saveError',
          defaultMessage: 'Knowledge sources could not be updated.',
        })
      )
    }
  }

  return (
    <KnowledgeCard rows={rows} busy={update.isPending} onToggle={(s, n) => void toggle(s, n)} />
  )
}

/** Side-by-side controls use the existing revision-aware per-profile mutations. */
export function QuinnKnowledgeCard() {
  const canManageArticles = usePermission(PERMISSIONS.HELP_CENTER_MANAGE)
  const query = useQuery(assistantQueries.settings())
  const updateCustomer = useUpdateAssistantAgentKnowledge()
  const updateTeam = useUpdateAssistantCopilotKnowledge()
  const busy = updateCustomer.isPending || updateTeam.isPending
  if (query.isError) return <KnowledgeError onRetry={() => void query.refetch()} />
  if (!query.data) return <KnowledgeLoading />
  const { config, revision, managedFieldPaths } = query.data
  async function toggle(source: string, use: 'agent' | 'copilot', next: boolean) {
    try {
      if (use === 'agent')
        await updateCustomer.mutateAsync({
          expectedRevision: revision,
          knowledge: { ...config.agents.agent.knowledge, [source]: next },
        })
      else
        await updateTeam.mutateAsync({
          expectedRevision: revision,
          knowledge: { ...config.agents.copilot.knowledge, [source]: next },
        })
    } catch {
      toast.error('Knowledge sources could not be updated. Refresh and try again.')
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Add source
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => document.getElementById('quinn-document-upload')?.click()}
            >
              Upload document
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                setTimeout(() => {
                  const field = document.getElementById('quinn-web-page-url')
                  field?.scrollIntoView({ block: 'center' })
                  field?.focus()
                }, 0)
              }
            >
              Add web page
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="rounded-xl border border-border/50 bg-card divide-y">
        <div className="hidden sm:grid grid-cols-[1fr_10rem_10rem] gap-3 p-4 text-xs font-medium text-muted-foreground">
          <span>Source</span>
          <span>Customer conversations</span>
          <span>Support teammates</span>
        </div>
        {ASSISTANT_COPILOT_KNOWLEDGE_SOURCES.map((source) => (
          <div
            key={source}
            className="grid gap-3 p-4 sm:grid-cols-[1fr_10rem_10rem] sm:items-center"
          >
            <div>
              <h2 className="text-sm font-medium">{SOURCE_META[source].label}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {SOURCE_META[source].description}
              </p>
              {source === 'helpCenter' && <QuinnArticleHealth />}
              {source === 'helpCenter' && canManageArticles && (
                <Link
                  to="/admin/help-center"
                  className="mt-2 inline-block text-xs font-medium text-primary"
                >
                  Manage articles →
                </Link>
              )}
            </div>
            {(['agent', 'copilot'] as const).map((use) => {
              const supported = source in config.agents[use].knowledge
              const managed = isAssistantFieldManaged(
                managedFieldPaths,
                `agents.${use}.knowledge.${source}`
              )
              const enabled =
                supported &&
                Boolean((config.agents[use].knowledge as Record<string, boolean>)[source])
              const label = use === 'agent' ? 'Customer conversations' : 'Support teammates'
              return (
                <div key={use} className="flex items-center gap-2 sm:block space-y-1">
                  <span className="sm:hidden text-xs flex-1">{label}</span>
                  <Switch
                    checked={enabled}
                    disabled={!supported || managed || busy}
                    aria-label={`${SOURCE_META[source].label}: ${label}`}
                    onCheckedChange={(next) => void toggle(source, use, next)}
                  />
                  {!supported && (
                    <p className="text-xs text-muted-foreground">Never for customers</p>
                  )}
                  {managed && <ManagedSettingHint />}
                </div>
              )
            })}
            {(source === 'documents' || source === 'webPages') && (
              <div className="sm:col-span-3">
                <QuinnKnowledgeSources kind={source === 'documents' ? 'document' : 'webpage'} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Type switches limit every source in that type. Articles are managed in Help Center;
        documents and web pages are managed here. Workspace and Slack use managed defaults.
      </p>
    </div>
  )
}
