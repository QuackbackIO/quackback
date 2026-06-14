import { useMemo, useState, useTransition } from 'react'
import { createFileRoute, useRouter, Navigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { CannedReply } from '@/lib/server/domains/settings/settings.types'
import { DEFAULT_OFFICE_HOURS } from '@/lib/server/domains/settings/settings.types'
import type { OfficeHoursConfig } from '@/lib/shared/chat/types'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { useQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdatePortalConfig, useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { getEmailChannelStatusFn } from '@/lib/server/functions/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

// Index 0 = Sunday … 6 = Saturday, matching OfficeHoursConfig.days.
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const Route = createFileRoute('/admin/settings/conversations')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: ConversationsSettingsRoute,
})

/**
 * Gate the live chat settings page behind the experimental `supportInbox` flag
 * (off by default), mirroring the help-center route. Wrapping keeps the flag
 * check above the page's hooks so they aren't conditionally called.
 */
function ConversationsSettingsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <ConversationsSettingsPage />
}

function ConversationsSettingsPage() {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const updatePortalConfig = useUpdatePortalConfig()
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = widgetConfigQuery.data
  const [isPending, startTransition] = useTransition()
  const [savingField, setSavingField] = useState<string | null>(null)
  const [portalSupportEnabled, setPortalSupportEnabled] = useState(
    portalConfigQuery.data?.support?.enabled ?? false
  )

  const [enabled, setEnabled] = useState(config.chat?.enabled ?? false)
  const [welcomeMessage, setWelcomeMessage] = useState(config.chat?.welcomeMessage ?? '')
  const [offlineMessage, setOfflineMessage] = useState(config.chat?.offlineMessage ?? '')
  const [teamName, setTeamName] = useState(config.chat?.teamName ?? '')
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>(
    config.chat?.cannedReplies ?? []
  )
  const [officeHours, setOfficeHours] = useState<OfficeHoursConfig>(
    config.chat?.officeHours ?? DEFAULT_OFFICE_HOURS
  )
  const [preChatEmail, setPreChatEmail] = useState<'off' | 'optional' | 'required'>(
    config.chat?.preChatEmail ?? 'off'
  )
  const [routingEnabled, setRoutingEnabled] = useState(config.chat?.routing?.enabled ?? false)

  const widgetEnabled = config.enabled

  const timezones = useMemo<string[]>(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return [officeHours.timezone || 'UTC']
    }
  }, [officeHours.timezone])

  // Persist the whole schedule on every change (deepMerge replaces arrays).
  function saveOfficeHours(next: OfficeHoursConfig) {
    setOfficeHours(next)
    void persist('officeHours', { chat: { officeHours: next } })
  }

  function saveCannedReplies(next: CannedReply[]) {
    setCannedReplies(next)
    // Persist only well-formed rows (both fields filled).
    const cleaned = next
      .map((r) => ({ id: r.id, title: r.title.trim(), body: r.body.trim() }))
      .filter((r) => r.title && r.body)
    void persist('cannedReplies', { chat: { cannedReplies: cleaned } })
  }

  async function persist(
    field: string,
    data: Parameters<typeof updateWidgetConfig.mutateAsync>[0],
    revert?: () => void
  ) {
    setSavingField(field)
    try {
      await updateWidgetConfig.mutateAsync(data)
      startTransition(() => router.invalidate())
    } catch {
      revert?.()
    } finally {
      setSavingField(null)
    }
  }

  const onToggleEnabled = (checked: boolean) => {
    setEnabled(checked)
    // Enabling chat also surfaces the widget tab; disabling hides it.
    persist('enabled', { chat: { enabled: checked }, tabs: { chat: checked } }, () =>
      setEnabled(!checked)
    )
  }

  const onTogglePortalSupport = async (checked: boolean) => {
    setPortalSupportEnabled(checked)
    setSavingField('portalSupport')
    try {
      await updatePortalConfig.mutateAsync({ support: { enabled: checked } })
      startTransition(() => router.invalidate())
    } catch {
      setPortalSupportEnabled(!checked)
    } finally {
      setSavingField(null)
    }
  }

  const onToggleRouting = (checked: boolean) => {
    setRoutingEnabled(checked)
    persist(
      'routing',
      { chat: { routing: { enabled: checked, strategy: 'auto_assign_active' } } },
      () => setRoutingEnabled(!checked)
    )
  }

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Conversations"
        description="How support conversations work: the live chat channel in the widget and how new conversations are routed to your team."
      />

      {!widgetEnabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          The widget is currently disabled. Enable it under{' '}
          <span className="font-medium">Widget</span> settings for live chat to appear.
        </div>
      )}

      <SettingsCard
        title="Live Chat"
        description="Show a live chat tab in the widget so visitors can start a conversation with your team."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="chat-enabled" className="text-sm font-medium cursor-pointer">
              Enable live chat
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Adds a live chat tab to the widget; conversations land in your support inbox. Turning
              it off removes chat entirely — to pause outside working hours instead, set office
              hours below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savingField === 'enabled' && (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <Switch
              id="chat-enabled"
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              disabled={isBusy}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Portal Support"
        description="Show a Support tab on your public portal where signed-in users can view their conversations and start new ones."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="portal-support-enabled" className="text-sm font-medium cursor-pointer">
              Enable Support tab
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Works independently of the widget — users sign in to the portal to see their full
              conversation history across surfaces.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savingField === 'portalSupport' && (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <Switch
              id="portal-support-enabled"
              checked={portalSupportEnabled}
              onCheckedChange={onTogglePortalSupport}
              disabled={isBusy}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Messaging"
        description="Customize the greeting and team name shown to visitors."
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="chat-team-name">Team name</Label>
            <Input
              id="chat-team-name"
              value={teamName}
              maxLength={80}
              placeholder="Support"
              onChange={(e) => setTeamName(e.target.value)}
              onBlur={() => persist('teamName', { chat: { teamName: teamName.trim() } })}
              disabled={isBusy || !enabled}
            />
            <p className="text-xs text-muted-foreground">
              Shown above agent replies. Defaults to your workspace name.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chat-welcome">Welcome message</Label>
            <Textarea
              id="chat-welcome"
              value={welcomeMessage}
              maxLength={500}
              rows={2}
              placeholder="Hi! 👋 How can we help you today?"
              onChange={(e) => setWelcomeMessage(e.target.value)}
              onBlur={() =>
                persist('welcomeMessage', { chat: { welcomeMessage: welcomeMessage.trim() } })
              }
              disabled={isBusy || !enabled}
            />
            <p className="text-xs text-muted-foreground">
              The first thing visitors see when they open chat. Use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{first_name}}'}</code>{' '}
              to greet known visitors by name.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chat-offline">Offline message</Label>
            <Textarea
              id="chat-offline"
              value={offlineMessage}
              maxLength={500}
              rows={2}
              placeholder="We're away right now — leave a message and we'll get back to you by email."
              onChange={(e) => setOfflineMessage(e.target.value)}
              onBlur={() =>
                persist('offlineMessage', { chat: { offlineMessage: offlineMessage.trim() } })
              }
              disabled={isBusy || !enabled}
            />
            <p className="text-xs text-muted-foreground">
              Shown when no agents are currently available to reply.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chat-prechat-email">Ask for an email</Label>
            <select
              id="chat-prechat-email"
              value={preChatEmail}
              onChange={(e) => {
                const next = e.target.value as 'off' | 'optional' | 'required'
                setPreChatEmail(next)
                void persist('preChatEmail', { chat: { preChatEmail: next } })
              }}
              disabled={isBusy || !enabled}
              className="w-full max-w-sm rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            >
              <option value="off">Don&apos;t ask</option>
              <option value="optional">Optional</option>
              <option value="required">Required before chatting</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Capture an email from anonymous visitors so you can follow up by email when offline.
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Office hours"
        description="Set when your team is available so the widget can manage visitor expectations outside those hours."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between py-1">
            <div className="pr-4">
              <Label htmlFor="office-hours-enabled" className="text-sm font-medium cursor-pointer">
                Enable office hours
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Outside these hours the widget shows your offline message.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {savingField === 'officeHours' && (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Switch
                id="office-hours-enabled"
                checked={officeHours.enabled}
                onCheckedChange={(checked) => saveOfficeHours({ ...officeHours, enabled: checked })}
                disabled={isBusy || !enabled}
              />
            </div>
          </div>

          {officeHours.enabled && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="office-hours-tz">Timezone</Label>
                <select
                  id="office-hours-tz"
                  value={officeHours.timezone}
                  onChange={(e) => saveOfficeHours({ ...officeHours, timezone: e.target.value })}
                  disabled={isBusy || !enabled}
                  className="w-full max-w-sm rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {officeHours.days.map((day, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex w-32 items-center gap-2">
                      <Switch
                        checked={day.enabled}
                        onCheckedChange={(checked) =>
                          saveOfficeHours({
                            ...officeHours,
                            days: officeHours.days.map((d, idx) =>
                              idx === i ? { ...d, enabled: checked } : d
                            ),
                          })
                        }
                        disabled={isBusy || !enabled}
                      />
                      <span className="text-sm">{DAY_LABELS[i]}</span>
                    </div>
                    <Input
                      type="time"
                      value={day.start}
                      onChange={(e) =>
                        saveOfficeHours({
                          ...officeHours,
                          days: officeHours.days.map((d, idx) =>
                            idx === i ? { ...d, start: e.target.value } : d
                          ),
                        })
                      }
                      disabled={isBusy || !enabled || !day.enabled}
                      className="w-32"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={day.end}
                      onChange={(e) =>
                        saveOfficeHours({
                          ...officeHours,
                          days: officeHours.days.map((d, idx) =>
                            idx === i ? { ...d, end: e.target.value } : d
                          ),
                        })
                      }
                      disabled={isBusy || !enabled || !day.enabled}
                      className="w-32"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Saved replies"
        description="Reusable responses agents can insert into a reply with one click."
      >
        <div className="space-y-3">
          {cannedReplies.length === 0 && (
            <p className="text-sm text-muted-foreground">No saved replies yet.</p>
          )}
          {cannedReplies.map((reply, i) => (
            <div
              key={reply.id}
              className="flex items-start gap-2 rounded-lg border border-border/60 p-2.5"
            >
              <div className="flex-1 space-y-1.5">
                <Input
                  value={reply.title}
                  maxLength={80}
                  placeholder="Title (e.g. Greeting)"
                  onChange={(e) =>
                    setCannedReplies((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, title: e.target.value } : r))
                    )
                  }
                  onBlur={() => saveCannedReplies(cannedReplies)}
                  disabled={isBusy}
                />
                <Textarea
                  value={reply.body}
                  maxLength={2000}
                  rows={2}
                  placeholder="Reply text…"
                  onChange={(e) =>
                    setCannedReplies((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, body: e.target.value } : r))
                    )
                  }
                  onBlur={() => saveCannedReplies(cannedReplies)}
                  disabled={isBusy}
                />
              </div>
              <button
                type="button"
                onClick={() => saveCannedReplies(cannedReplies.filter((_, idx) => idx !== i))}
                disabled={isBusy}
                className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                aria-label="Remove saved reply"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() =>
              setCannedReplies((prev) => [
                ...prev,
                { id: crypto.randomUUID(), title: '', body: '' },
              ])
            }
          >
            <PlusIcon className="h-4 w-4" /> Add reply
          </Button>
        </div>
      </SettingsCard>

      <EmailChannelStatusCard />

      <SettingsCard
        title="Conversation Routing"
        description="Decide how new conversations reach your team."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="routing-auto-assign" className="text-sm font-medium cursor-pointer">
              Auto-assign to an active agent
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Automatically assign each new conversation to an agent who is currently online. When
              no one is available, it stays unassigned for anyone to pick up.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savingField === 'routing' && (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <Switch
              id="routing-auto-assign"
              checked={routingEnabled}
              onCheckedChange={onToggleRouting}
              disabled={isBusy}
            />
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

/** One row of the email-channel status card: label, value, and an on/off dot. */
function EmailStatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm">
        <span
          className={
            ok ? 'size-2 rounded-full bg-emerald-500' : 'size-2 rounded-full bg-muted-foreground/40'
          }
          aria-hidden
        />
        {value}
      </span>
    </div>
  )
}

/**
 * Read-only status of the email channel (outbound provider, from-address,
 * inbound reply threading). Configuration itself is environment-based; this
 * card just makes the resolved state visible to admins.
 */
function EmailChannelStatusCard() {
  const { data } = useQuery({
    queryKey: ['settings', 'email-channel-status'],
    queryFn: () => getEmailChannelStatusFn(),
    staleTime: 60_000,
  })

  if (!data) return null

  const outboundLabel =
    data.provider === 'smtp' ? 'SMTP' : data.provider === 'resend' ? 'Resend' : 'Not configured'

  return (
    <SettingsCard
      title="Email channel"
      description="How conversation emails are sent and received. Configured via environment variables on the server."
    >
      <div className="divide-y divide-border/40">
        <EmailStatusRow
          label="Outbound email"
          value={outboundLabel}
          ok={data.provider !== 'console'}
        />
        <EmailStatusRow
          label="From address"
          value={data.fromAddress ?? 'Not set'}
          ok={!!data.fromAddress}
        />
        <EmailStatusRow
          label="Inbound replies"
          value={data.inboundConfigured ? (data.inboundDomain ?? 'Configured') : 'Not configured'}
          ok={data.inboundConfigured}
        />
      </div>
      {!data.inboundConfigured && (
        <p className="mt-2 text-xs text-muted-foreground">
          With inbound replies configured, users can answer conversation emails directly from their
          inbox and the reply lands back in the thread.
        </p>
      )}
      {data.provider === 'console' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Without an outbound provider, conversation emails are logged to the server console only —
          offline users and new outbound conversations won&apos;t receive email.
        </p>
      )}
    </SettingsCard>
  )
}
