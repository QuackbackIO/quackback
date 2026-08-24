import { useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, useRouter, Link, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdatePortalConfig, useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { WIDGET_LOCALE_LABELS, type WidgetTranslations } from '@/lib/shared/widget/translations'

export const Route = createFileRoute('/admin/settings/channels_/messenger')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: MessengerChannelPage,
})

export function MessengerChannelPage() {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const updatePortalConfig = useUpdatePortalConfig()
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = widgetConfigQuery.data
  const messengerConfig = config.messenger
  const [isPending, startTransition] = useTransition()
  const [savingField, setSavingField] = useState<string | null>(null)
  const [widgetMessenger, setWidgetMessenger] = useState(config.tabs?.messenger ?? true)
  const [portalSupportEnabled, setPortalSupportEnabled] = useState(
    portalConfigQuery.data?.support?.enabled ?? true
  )
  const [preventRepliesWhenClosed, setPreventRepliesWhenClosed] = useState(
    messengerConfig?.preventRepliesWhenClosed ?? false
  )
  const [welcomeMessage, setWelcomeMessage] = useState(messengerConfig?.welcomeMessage ?? '')
  const [offlineMessage, setOfflineMessage] = useState(messengerConfig?.offlineMessage ?? '')
  const [teamName, setTeamName] = useState(messengerConfig?.teamName ?? '')
  const [translations, setTranslations] = useState<WidgetTranslations>(config.translations ?? {})
  const [translationLocale, setTranslationLocale] = useState<string>('en')

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

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/channels">Channels</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Messenger"
        description="Live chat in the widget and on the portal."
      />

      <SettingsCard title="Surfaces" description="Where customers can start conversations.">
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="widget-messenger-tab" className="text-sm font-medium cursor-pointer">
              Widget
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Show the Messages tab in the widget.
            </p>
          </div>
          <Switch
            id="widget-messenger-tab"
            checked={widgetMessenger}
            onCheckedChange={(checked) => {
              setWidgetMessenger(checked)
              persist('widgetMessenger', { tabs: { messenger: checked } }, () =>
                setWidgetMessenger(!checked)
              )
            }}
            disabled={isBusy}
            aria-label="Widget"
          />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border/40 py-1 pt-4">
          <div className="pr-4">
            <Label htmlFor="portal-support-enabled" className="text-sm font-medium cursor-pointer">
              Portal chats
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Let signed-in customers start new conversations from the portal&apos;s Support tab.
            </p>
          </div>
          <Switch
            id="portal-support-enabled"
            checked={portalSupportEnabled}
            onCheckedChange={async (checked) => {
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
            }}
            disabled={isBusy}
            aria-label="Portal chats"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Messaging" description="Greeting and team name shown to visitors.">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="messenger-team-name">Team name</Label>
            <Input
              id="messenger-team-name"
              value={teamName}
              maxLength={80}
              placeholder="Support"
              onChange={(e) => setTeamName(e.target.value)}
              onBlur={() => persist('teamName', { messenger: { teamName: teamName.trim() } })}
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Shown in the messenger header. Falls back to the workspace name.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="messenger-welcome">Welcome message</Label>
            <Textarea
              id="messenger-welcome"
              value={welcomeMessage}
              maxLength={500}
              rows={2}
              placeholder="Hi! How can we help you today?"
              onChange={(e) => setWelcomeMessage(e.target.value)}
              onBlur={() =>
                persist('welcomeMessage', { messenger: { welcomeMessage: welcomeMessage.trim() } })
              }
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Greets a customer opening a new conversation.{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{first_name}}'}</code>{' '}
              inserts their name.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="messenger-offline">Offline message</Label>
            <Textarea
              id="messenger-offline"
              value={offlineMessage}
              maxLength={500}
              rows={2}
              placeholder="We're away right now. Leave a message and we'll get back to you by email."
              onChange={(e) => setOfflineMessage(e.target.value)}
              onBlur={() =>
                persist('offlineMessage', { messenger: { offlineMessage: offlineMessage.trim() } })
              }
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Shown outside{' '}
              <Link to="/admin/settings/office-hours" className="font-medium text-primary">
                office hours
              </Link>{' '}
              or when nobody is online.
            </p>
          </div>
          <MessengerTranslations
            translations={translations}
            selectedLocale={translationLocale}
            onSelectLocale={setTranslationLocale}
            disabled={isBusy}
            onCommit={(next) => {
              const prev = translations
              setTranslations(next)
              persist('translations', { translations: next }, () => setTranslations(prev))
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Reopen on reply"
        description="When a visitor replies to a closed Messenger conversation."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="prevent-replies-closed" className="text-sm font-medium cursor-pointer">
              Prevent replies to closed conversations
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Visitors start a new conversation instead of reopening. Email replies always reopen.
            </p>
          </div>
          <Switch
            id="prevent-replies-closed"
            checked={preventRepliesWhenClosed}
            onCheckedChange={(checked) => {
              setPreventRepliesWhenClosed(checked)
              persist('preventClosed', { messenger: { preventRepliesWhenClosed: checked } }, () =>
                setPreventRepliesWhenClosed(!checked)
              )
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Quinn" description="Assistant identity is configured in Automation.">
        <div className="flex items-center justify-between py-1">
          <p className="text-sm text-muted-foreground">
            {messengerConfig?.assistant?.enabled === false
              ? 'Off'
              : messengerConfig?.assistant?.respond
                ? 'Fronting conversations · answering on'
                : 'Fronting conversations · answering off'}
          </p>
          <Link to="/admin/automation/assistant" className="text-sm font-medium text-primary">
            Configure in Automation
          </Link>
        </div>
      </SettingsCard>
    </div>
  )
}

function MessengerTranslations({
  translations,
  selectedLocale,
  onSelectLocale,
  disabled,
  onCommit,
}: {
  translations: WidgetTranslations
  selectedLocale: string
  onSelectLocale: (locale: string) => void
  disabled: boolean
  onCommit: (next: WidgetTranslations) => void
}) {
  const isDefault = selectedLocale === 'en'
  const entry = translations[selectedLocale] ?? {}

  function commitField(key: 'welcomeMessage' | 'offlineMessage', raw: string) {
    const value = raw.trim()
    if (value === (entry[key] ?? '')) return
    const nextEntry = { ...entry, [key]: value || undefined }
    const next = { ...translations, [selectedLocale]: nextEntry }
    if (
      !nextEntry.welcomeMessage &&
      !nextEntry.offlineMessage &&
      !nextEntry.greeting &&
      !nextEntry.subtitle
    ) {
      const { [selectedLocale]: _removed, ...rest } = next
      onCommit(rest)
      return
    }
    onCommit(next)
  }

  return (
    <div className="border-t border-border/40 pt-4 space-y-3">
      <span className="text-sm font-medium">Translations</span>
      <div className="flex flex-wrap gap-1.5">
        {SUPPORTED_LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => onSelectLocale(locale)}
            disabled={disabled}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
              selectedLocale === locale
                ? 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border/50 text-muted-foreground hover:text-foreground'
            )}
          >
            {WIDGET_LOCALE_LABELS[locale] ?? locale}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Welcome and offline messages per locale.</p>
      {!isDefault && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="messenger-welcome-locale">Welcome message</Label>
            <Textarea
              id="messenger-welcome-locale"
              defaultValue={entry.welcomeMessage ?? ''}
              key={`${selectedLocale}-welcome`}
              maxLength={500}
              rows={2}
              placeholder="Hi! How can we help you today?"
              disabled={disabled}
              onBlur={(e) => commitField('welcomeMessage', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="messenger-offline-locale">Offline message</Label>
            <Textarea
              id="messenger-offline-locale"
              defaultValue={entry.offlineMessage ?? ''}
              key={`${selectedLocale}-offline`}
              maxLength={500}
              rows={2}
              placeholder="We're away right now. Leave a message and we'll get back to you by email."
              disabled={disabled}
              onBlur={(e) => commitField('offlineMessage', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
