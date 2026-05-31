import { useMemo, useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { CannedReply } from '@/lib/server/domains/settings/settings.types'
import { DEFAULT_OFFICE_HOURS } from '@/lib/server/domains/settings/settings.types'
import type { OfficeHoursConfig } from '@/lib/shared/chat/types'
import { settingsQueries } from '@/lib/client/queries/settings'
import { updateWidgetConfigFn } from '@/lib/server/functions/settings'
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

export const Route = createFileRoute('/admin/settings/live-chat')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await context.queryClient.ensureQueryData(settingsQueries.widgetConfig())
    return {}
  },
  component: LiveChatSettingsPage,
})

function LiveChatSettingsPage() {
  const router = useRouter()
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const config = widgetConfigQuery.data
  const [isPending, startTransition] = useTransition()
  const [savingField, setSavingField] = useState<string | null>(null)

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
    data: Parameters<typeof updateWidgetConfigFn>[0]['data'],
    revert?: () => void
  ) {
    setSavingField(field)
    try {
      await updateWidgetConfigFn({ data })
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

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Live Chat"
        description="Let visitors message your team in real time from the widget."
      />

      {!widgetEnabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          The widget is currently disabled. Enable it under{' '}
          <span className="font-medium">Widget</span> settings for live chat to appear.
        </div>
      )}

      <SettingsCard
        title="Live chat"
        description="Show a chat tab in the widget so visitors can start a conversation with your team."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="chat-enabled" className="text-sm font-medium cursor-pointer">
              Enable live chat
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Adds a Chat tab to the widget and an inbox in the admin panel.
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
              The first thing visitors see when they open chat.
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
    </div>
  )
}
