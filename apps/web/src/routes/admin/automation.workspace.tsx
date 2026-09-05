import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { updateWorkspaceAssistantFn } from '@/lib/server/functions/assistant-settings'
import {
  ASSISTANT_COPILOT_KNOWLEDGE_SOURCES,
  type AssistantWorkspaceConfig,
} from '@/lib/shared/assistant/config'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
export const Route = createFileRoute('/admin/automation/workspace')({
  beforeLoad: ({ context }) => {
    if (
      !((context as { permissions?: PermissionKey[] }).permissions ?? []).includes(
        PERMISSIONS.ASSISTANT_MANAGE
      )
    )
      throw new Error('Access denied: requires assistant.manage')
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  component: WorkspaceAssistantPage,
})
function WorkspaceAssistantPage() {
  const query = useQuery(assistantQueries.settings())
  if (!query.data)
    return (
      <p role="status">
        {query.isError ? 'Could not load workspace assistant settings.' : 'Loading…'}
      </p>
    )
  return (
    <WorkspaceForm workspace={query.data.config.agents.workspace} revision={query.data.revision} />
  )
}
const labels: Record<string, string> = {
  helpCenter: 'Help center',
  posts: 'Feedback',
  pastConversations: 'Support conversations',
  internalNotes: 'Internal notes',
  tickets: 'Tickets',
  changelog: 'Changelog',
  documents: 'Documents',
  status: 'Service status',
}
function WorkspaceForm({
  workspace,
  revision,
}: {
  workspace: AssistantWorkspaceConfig
  revision: number
}) {
  const [draft, setDraft] = useState(workspace)
  const [base, setBase] = useState(workspace)
  const [baseRevision, setBaseRevision] = useState(revision)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)
  useEffect(() => {
    if (!dirty) {
      setBase(workspace)
      setDraft(workspace)
      setBaseRevision(revision)
    }
  }, [workspace, revision, dirty])
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('Discard unsaved workspace assistant changes?'),
    enableBeforeUnload: dirty,
  })
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceAssistantFn({ data: { expectedRevision: baseRevision, workspace: draft } }),
    onSuccess: async (result) => {
      setBase(result.config.agents.workspace)
      setDraft(result.config.agents.workspace)
      setBaseRevision(result.revision)
      await queryClient.invalidateQueries({ queryKey: ['assistant', 'settings'] })
    },
  })
  return (
    <form
      className="max-w-3xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <header>
        <h1 className="text-lg font-semibold">Workspace assistant</h1>
        <p className="text-sm text-muted-foreground">
          Answers your team’s questions and proposes feedback and tickets for approval.
        </p>
      </header>
      <p className="text-sm">
        Deployed in:{' '}
        <a className="underline" href="/admin/settings/integrations/slack#ai-assistant">
          Slack {workspace.slack.enabled ? '✓' : '–'}
        </a>
      </p>
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="font-medium">Knowledge</h2>
        {ASSISTANT_COPILOT_KNOWLEDGE_SOURCES.map((source) => (
          <div key={source} className="flex items-center justify-between gap-4">
            <Label htmlFor={`workspace-${source}`}>{labels[source]}</Label>
            <Switch
              id={`workspace-${source}`}
              checked={draft.knowledge[source]}
              onCheckedChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  knowledge: { ...current.knowledge, [source]: value },
                }))
              }
            />
          </div>
        ))}
      </section>
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="font-medium">Actions</h2>
        <p className="text-sm text-muted-foreground">
          Enabled actions always need a teammate’s approval.
        </p>
        {[
          ['capture_feedback', 'Capture feedback'],
          ['create_ticket', 'Create ticket'],
        ].map(([tool, label]) => (
          <div key={tool} className="flex items-center justify-between">
            <Label htmlFor={`workspace-${tool}`}>{label}</Label>
            <Switch
              id={`workspace-${tool}`}
              checked={draft.toolRules[tool] !== 'deny'}
              onCheckedChange={(enabled) =>
                setDraft((current) => ({
                  ...current,
                  toolRules: { ...current.toolRules, [tool]: enabled ? 'ask' : 'deny' },
                }))
              }
            />
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <Label htmlFor="workspace-instructions">Instructions</Label>
        <Textarea
          id="workspace-instructions"
          value={draft.instructions}
          maxLength={2000}
          placeholder="How your team files feedback, preferred boards, and other guidance."
          onChange={(event) =>
            setDraft((current) => ({ ...current, instructions: event.target.value }))
          }
        />
        <p className="text-xs text-muted-foreground">{draft.instructions.length}/2000 characters</p>
      </section>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <Button type="submit" disabled={!dirty || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
