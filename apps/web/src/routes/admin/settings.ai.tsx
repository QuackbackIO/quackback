import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition } from 'react'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Avatar } from '@/components/ui/avatar'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { SupportPerformanceCard } from '@/components/admin/automation/support-performance-card'

export const Route = createFileRoute('/admin/settings/ai')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    await context.queryClient.ensureQueryData(settingsQueries.widgetConfig())
    return {}
  },
  component: AiSettingsPage,
})

/**
 * AI & Automation settings. Today this hosts the assistant's display identity
 * (name + avatar) that fronts new messenger conversations; the integrated
 * agent and automation rules will live here as they land.
 */
function AiSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const assistant = widgetConfigQuery.data.messenger?.assistant

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={SparklesIcon}
        title="AI & Automation"
        description="Configure your AI assistant's identity and upcoming automations"
      />

      <AssistantIdentityCard
        initial={{
          enabled: assistant?.enabled ?? true,
          respond: assistant?.respond ?? false,
          name: assistant?.name ?? 'Quinn',
          avatarUrl: assistant?.avatarUrl ?? '',
        }}
      />

      <SupportPerformanceCard />
    </div>
  )
}

function AssistantIdentityCard({
  initial,
}: {
  initial: { enabled: boolean; respond: boolean; name: string; avatarUrl: string }
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const [enabled, setEnabled] = useState(initial.enabled)
  const [respond, setRespond] = useState(initial.respond)
  const [name, setName] = useState(initial.name)
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl)
  // Last persisted values, so blur only saves actual changes.
  const [savedName, setSavedName] = useState(initial.name)
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(initial.avatarUrl)

  const isBusy = saving || isPending

  async function save(
    updates: { enabled?: boolean; respond?: boolean; name?: string; avatarUrl?: string },
    revert: () => void
  ) {
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ messenger: { assistant: updates } })
      startTransition(() => router.invalidate())
    } catch {
      revert()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="AI Agent"
      description="The fastest way to deploy your AI assistant to the messenger"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="assistant-enabled" className="text-sm font-medium cursor-pointer">
              Enable AI agent
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your assistant greets visitors and fronts new conversations. When off, the messenger
              uses your team name and live availability instead.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={isBusy} />
            <Switch
              id="assistant-enabled"
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked)
                void save({ enabled: checked }, () => setEnabled(!checked))
              }}
              disabled={isBusy}
              aria-label="Assistant identity"
            />
          </div>
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
              <div>
                <Label htmlFor="assistant-respond" className="text-sm font-medium cursor-pointer">
                  Reply to messages automatically
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your assistant answers new messenger conversations from your help center and hands
                  off to your team when it can&apos;t help. When off, it only greets and fronts new
                  conversations.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <InlineSpinner visible={isBusy} />
                <Switch
                  id="assistant-respond"
                  checked={respond}
                  onCheckedChange={(checked) => {
                    setRespond(checked)
                    void save({ respond: checked }, () => setRespond(!checked))
                  }}
                  disabled={isBusy}
                  aria-label="Reply to messages automatically"
                />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-border/50 p-4">
              <div className="flex items-center gap-3">
                <Avatar
                  src={avatarUrl || null}
                  name={name || 'Quinn'}
                  className="size-10 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  This identity appears on the greeting, the new-conversation header, and unassigned
                  conversations in the Messages tab.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="assistant-name" className="text-xs text-muted-foreground">
                  Name
                </Label>
                <Input
                  id="assistant-name"
                  value={name}
                  maxLength={80}
                  placeholder="Quinn"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    const next = name.trim() || 'Quinn'
                    setName(next)
                    if (next === savedName) return
                    void save({ name: next }, () => setName(savedName))
                    setSavedName(next)
                  }}
                  disabled={isBusy}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assistant-avatar" className="text-xs text-muted-foreground">
                  Avatar URL
                </Label>
                <Input
                  id="assistant-avatar"
                  value={avatarUrl}
                  maxLength={2000}
                  placeholder="https://example.com/assistant.png"
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  onBlur={() => {
                    const next = avatarUrl.trim()
                    if (next === savedAvatarUrl) return
                    void save({ avatarUrl: next }, () => setAvatarUrl(savedAvatarUrl))
                    setSavedAvatarUrl(next)
                  }}
                  disabled={isBusy}
                />
                <p className="text-xs text-muted-foreground">
                  Falls back to the assistant&apos;s initial when empty.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  )
}
