import { createFileRoute, useRouter, useRouteContext, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo, useEffect } from 'react'
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  SparklesIcon,
  SunIcon,
  MoonIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  PlusIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WarningBox } from '@/components/shared/warning-box'
import {
  WidgetPreview,
  type WidgetPreviewTabs,
} from '@/components/admin/settings/widget/widget-preview'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  useUpdateWidgetConfig,
  useRegenerateWidgetSecret,
  useUploadWidgetHeroImage,
  useDeleteWidgetHeroImage,
} from '@/lib/client/mutations/settings'
import type {
  FeatureFlags,
  WidgetHomeCard,
  WidgetHomeCardType,
  WidgetCardAudience,
  WidgetHomeConfig,
} from '@/lib/shared/types/settings'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import type { WidgetContentTranslation, WidgetTranslations } from '@/lib/shared/widget/translations'
import { DEFAULT_WIDGET_HOME_CARDS } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/widget')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      queryClient.ensureQueryData(settingsQueries.helpCenterConfig()),
      queryClient.ensureQueryData(adminQueries.boards()),
    ])

    return {}
  },
  component: WidgetSettingsPage,
})

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const widgetSecretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const helpCenterConfigQuery = useSuspenseQuery(settingsQueries.helpCenterConfig())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const { baseUrl, settings } = useRouteContext({ from: '__root__' })

  const flags = settings?.featureFlags as FeatureFlags | undefined
  const config = widgetConfigQuery.data
  const helpCenterConfig = helpCenterConfigQuery.data

  const helpCenterFlagEnabled = flags?.helpCenter ?? false
  const helpCenterEnabled = helpCenterConfig?.enabled ?? false
  const supportInboxFlagEnabled = flags?.supportInbox ?? false
  const messengerEnabled = config.messenger?.enabled ?? false

  // Lifted editor state so the live preview reacts to every control.
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    (config.position as 'bottom-right' | 'bottom-left') ?? 'bottom-right'
  )
  const [previewTabs, setPreviewTabs] = useState<WidgetPreviewTabs>({
    home: config.tabs?.home ?? true,
    messenger: (config.tabs?.messenger ?? false) && supportInboxFlagEnabled && messengerEnabled,
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
    help: (config.tabs?.help ?? false) && helpCenterFlagEnabled && helpCenterEnabled,
  })
  const [homeDraft, setHomeDraft] = useState<WidgetHomeConfig>(config.home ?? {})
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light')

  return (
    <div className="space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Widget"
        description="Embed the messenger widget in your product — feedback, conversations, help, and updates"
      />

      {/* Full-screen editor: controls left, live preview right (sticky). */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <WidgetToggle initialEnabled={config.enabled} />

          <ModulesCard
            config={config}
            boards={boardsQuery.data}
            position={position}
            onPositionChange={setPosition}
            previewTabs={previewTabs}
            onPreviewTabsChange={setPreviewTabs}
            helpCenterFlagEnabled={helpCenterFlagEnabled}
            helpCenterEnabled={helpCenterEnabled}
            supportInboxFlagEnabled={supportInboxFlagEnabled}
            messengerEnabled={messengerEnabled}
          />

          <HomeCustomizationCard
            home={homeDraft}
            heroImageUrl={config.home?.heroImageUrl ?? null}
            onHomeChange={setHomeDraft}
          />

          <AssistantLinkCard assistant={config.messenger?.assistant} />

          <WidgetTranslationsCard translations={config.translations} />
        </div>

        <div className="xl:sticky xl:top-6 min-w-0 xl:h-[calc(100vh-7.5rem)] flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Preview</span>
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setPreviewTheme('light')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  previewTheme === 'light'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <SunIcon className="h-3.5 w-3.5" />
                Light
              </button>
              <button
                type="button"
                onClick={() => setPreviewTheme('dark')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  previewTheme === 'dark'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <MoonIcon className="h-3.5 w-3.5" />
                Dark
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <WidgetPreview
              position={position}
              tabs={previewTabs}
              home={{ ...homeDraft, heroImageUrl: config.home?.heroImageUrl ?? null }}
              assistant={config.messenger?.assistant}
              teamName={config.messenger?.teamName || settings?.name || null}
              logoUrl={settings?.brandingData?.logoUrl ?? null}
              theme={previewTheme}
            />
          </div>
        </div>
      </div>

      <WidgetInstallation secret={widgetSecretQuery.data} baseUrl={baseUrl ?? ''} />
    </div>
  )
}

function WidgetToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)

  async function handleToggle(checked: boolean) {
    setEnabled(checked)
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ enabled: checked })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard title="Widget" description="Enable or disable the embeddable widget">
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div>
          <Label htmlFor="widget-toggle" className="text-sm font-medium cursor-pointer">
            Enable Widget
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            When enabled, you can embed the widget on any website using a script tag
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InlineSpinner visible={saving || isPending} />
          <Switch
            id="widget-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving || isPending}
            aria-label="Widget"
          />
        </div>
      </div>
    </SettingsCard>
  )
}

function ModulesCard({
  config,
  boards,
  position,
  onPositionChange,
  previewTabs,
  onPreviewTabsChange,
  helpCenterFlagEnabled,
  helpCenterEnabled,
  supportInboxFlagEnabled,
  messengerEnabled,
}: {
  config: {
    defaultBoard?: string
    launcherGreeting?: string
    tabs?: {
      feedback?: boolean
      changelog?: boolean
      help?: boolean
      messenger?: boolean
      home?: boolean
    }
  }
  boards: { id: string; name: string; slug: string }[]
  position: 'bottom-right' | 'bottom-left'
  onPositionChange: (val: 'bottom-right' | 'bottom-left') => void
  previewTabs: WidgetPreviewTabs
  onPreviewTabsChange: (tabs: WidgetPreviewTabs) => void
  helpCenterFlagEnabled: boolean
  helpCenterEnabled: boolean
  supportInboxFlagEnabled: boolean
  messengerEnabled: boolean
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [tabs, setTabs] = useState({
    home: config.tabs?.home ?? true,
    messenger: config.tabs?.messenger ?? false,
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
    help: config.tabs?.help ?? false,
  })

  const showHelpToggle = helpCenterFlagEnabled && helpCenterEnabled
  const showMessagesToggle = supportInboxFlagEnabled && messengerEnabled
  const showMessagesHint = supportInboxFlagEnabled && !messengerEnabled

  const isBusy = saving || isPending

  async function save(updates: Parameters<typeof updateWidgetConfig.mutateAsync>[0]) {
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync(updates)
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  /** Persist one tab flag; keeps local + preview state in sync, reverts on error. */
  async function saveTab(key: keyof typeof tabs, checked: boolean, previewValue = checked) {
    const prev = tabs[key]
    const prevPreview = previewTabs[key]
    setTabs({ ...tabs, [key]: checked })
    onPreviewTabsChange({ ...previewTabs, [key]: previewValue })
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ tabs: { [key]: checked } })
      startTransition(() => router.invalidate())
    } catch {
      setTabs({ ...tabs, [key]: prev })
      onPreviewTabsChange({ ...previewTabs, [key]: prevPreview })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Modules"
      description="Choose which sections the widget shows. The tab bar hides with a single section."
    >
      <div className="space-y-3">
        <TabRow
          id="tab-home"
          label="Home"
          description="Overview tab that greets users and links to your sections. Only appears when two or more sections are enabled."
          checked={tabs.home}
          disabled={isBusy}
          saving={saving}
          onChange={(checked) => void saveTab('home', checked)}
        />

        {showMessagesToggle && (
          <TabRow
            id="tab-messages"
            label="Messages"
            description="Conversations with your team and assistant"
            checked={tabs.messenger}
            disabled={isBusy}
            saving={saving}
            onChange={(checked) => void saveTab('messenger', checked)}
          />
        )}
        {showMessagesHint && (
          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              Enable Messenger in{' '}
              <Link to="/admin/settings/conversations" className="font-medium text-primary">
                Conversations settings
              </Link>{' '}
              to add a Messages tab.
            </p>
          </div>
        )}

        <TabRow
          id="tab-feedback"
          label="Feedback"
          description="Search, vote, and submit ideas"
          checked={tabs.feedback}
          disabled={isBusy || (tabs.feedback && !tabs.changelog)}
          saving={saving}
          onChange={(checked) => {
            if (!checked && !tabs.changelog) return
            void saveTab('feedback', checked)
          }}
        />

        {showHelpToggle && (
          <TabRow
            id="tab-help"
            label="Help"
            description="Browse and search help center articles"
            checked={tabs.help}
            disabled={isBusy}
            saving={saving}
            onChange={(checked) => void saveTab('help', checked)}
          />
        )}

        <TabRow
          id="tab-changelog"
          label="Changelog"
          description="Show product updates and shipped features"
          checked={tabs.changelog}
          disabled={isBusy || (tabs.changelog && !tabs.feedback)}
          saving={saving}
          onChange={(checked) => {
            if (!checked && !tabs.feedback) return
            void saveTab('changelog', checked)
          }}
        />
      </div>

      <div className="mt-5 space-y-2">
        <Label htmlFor="widget-position" className="text-xs text-muted-foreground">
          Button position
        </Label>
        <Select
          value={position}
          onValueChange={(val: 'bottom-right' | 'bottom-left') => {
            onPositionChange(val)
            void save({ position: val })
          }}
          disabled={isBusy}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom-right">Bottom Right</SelectItem>
            <SelectItem value="bottom-left">Bottom Left</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="launcher-greeting" className="text-xs text-muted-foreground">
          Launcher greeting
        </Label>
        <Input
          id="launcher-greeting"
          defaultValue={config.launcherGreeting ?? ''}
          maxLength={120}
          placeholder="e.g. Need a hand?"
          disabled={isBusy}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value === (config.launcherGreeting ?? '')) return
            void save({ launcherGreeting: value })
          }}
        />
        <p className="text-[11px] text-muted-foreground/70">
          Shown in a bubble beside the closed launcher to invite a chat. Leave blank for none.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <Label className="text-xs text-muted-foreground">Default board</Label>
        <Select
          value={defaultBoard || ''}
          onValueChange={(val) => {
            setDefaultBoard(val)
            void save({ defaultBoard: val })
          }}
          disabled={isBusy}
        >
          <SelectTrigger
            className="w-full"
            onClear={
              defaultBoard
                ? () => {
                    setDefaultBoard('')
                    void save({ defaultBoard: '' })
                  }
                : undefined
            }
          >
            <SelectValue placeholder="No default board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.slug}>
                {board.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Which board new posts from the widget default to
        </p>
      </div>
    </SettingsCard>
  )
}

function TabRow({
  id,
  label,
  description,
  checked,
  disabled,
  saving,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  saving: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
      <div className="pe-3">
        <Label htmlFor={id} className="text-xs font-medium cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <InlineSpinner visible={saving} />
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={`${label} tab`}
        />
      </div>
    </div>
  )
}

const CARD_TYPE_LABEL: Record<WidgetHomeCardType, string> = {
  feedback: 'Feedback',
  new_conversation: 'New conversation',
  article_search: 'Article search',
  latest_updates: 'Latest updates',
  link: 'Link',
}

function HomeCustomizationCard({
  home,
  heroImageUrl,
  onHomeChange,
}: {
  home: WidgetHomeConfig
  /** Server-resolved hero image URL (the key itself never reaches the client). */
  heroImageUrl: string | null
  onHomeChange: (home: WidgetHomeConfig) => void
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const uploadHero = useUploadWidgetHeroImage()
  const deleteHero = useDeleteWidgetHeroImage()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const isBusy = saving || isPending || uploadHero.isPending || deleteHero.isPending
  const cards = home.cards?.length ? home.cards : DEFAULT_WIDGET_HOME_CARDS

  async function handleHeroFile(file: File | undefined) {
    if (!file) return
    await uploadHero.mutateAsync(file)
    // The upload fn also switches the header style server-side; mirror locally
    // so the select + preview reflect it immediately.
    onHomeChange({ ...home, headerStyle: 'image' })
    startTransition(() => router.invalidate())
  }

  async function handleHeroRemove() {
    await deleteHero.mutateAsync()
    onHomeChange({ ...home, headerStyle: 'plain' })
    startTransition(() => router.invalidate())
  }

  async function save(updates: WidgetHomeConfig, revert: () => void) {
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ home: updates })
      startTransition(() => router.invalidate())
    } catch {
      revert()
    } finally {
      setSaving(false)
    }
  }

  /** Apply + persist a partial home update, reverting local state on failure. */
  function commit(patch: WidgetHomeConfig) {
    const prev = home
    const next = { ...home, ...patch }
    onHomeChange(next)
    void save(patch, () => onHomeChange(prev))
  }

  /** Persist a full replacement of the cards array (order matters). */
  function commitCards(next: WidgetHomeCard[]) {
    commit({ cards: next })
  }

  function moveCard(index: number, delta: -1 | 1) {
    const next = [...cards]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    commitCards(next)
  }

  function updateCard(index: number, patch: Partial<WidgetHomeCard>) {
    const next = cards.map((c, i) => (i === index ? { ...c, ...patch } : c))
    commitCards(next)
  }

  return (
    <SettingsCard
      title="Home"
      description="Customise the greeting, header, and the cards shown on the Home tab"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="home-greeting" className="text-xs text-muted-foreground">
            Greeting
          </Label>
          <Input
            id="home-greeting"
            defaultValue={home.greeting ?? ''}
            maxLength={120}
            placeholder="Hi {name} 👋"
            onBlur={(e) => {
              const value = e.target.value.trim()
              if (value === (home.greeting ?? '')) return
              commit({ greeting: value })
            }}
            disabled={isBusy}
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="text-[11px]">{'{name}'}</code> to greet signed-in users by first
            name
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="home-subtitle" className="text-xs text-muted-foreground">
            Subtitle
          </Label>
          <Input
            id="home-subtitle"
            defaultValue={home.subtitle ?? ''}
            maxLength={200}
            placeholder="How can we help?"
            onBlur={(e) => {
              const value = e.target.value.trim()
              if (value === (home.subtitle ?? '')) return
              commit({ subtitle: value })
            }}
            disabled={isBusy}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Background</Label>
          <Select
            value={home.headerStyle ?? 'plain'}
            onValueChange={(val: 'plain' | 'gradient' | 'image') => commit({ headerStyle: val })}
            disabled={isBusy}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain</SelectItem>
              <SelectItem value="gradient">Brand gradient</SelectItem>
              <SelectItem value="image">Image</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Fills the whole widget behind the header and Home content
          </p>
        </div>

        {(home.headerStyle === 'image' || heroImageUrl) && (
          <div className="space-y-2 rounded-lg border border-border/50 p-3">
            {heroImageUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={heroImageUrl}
                  alt=""
                  className="h-16 w-10 rounded-md border border-border/50 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">Background image</p>
                  <p className="text-xs text-muted-foreground">
                    Shown behind the whole widget, fading into the content
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  disabled={isBusy}
                  onClick={() => void handleHeroRemove()}
                  aria-label="Remove background image"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Upload an image to fill the open widget (recommended ~800×1400px, portrait — it
                covers the full panel).
              </p>
            )}
            <label className="inline-flex">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={isBusy}
                onChange={(e) => {
                  void handleHeroFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <span
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted',
                  isBusy && 'pointer-events-none opacity-50'
                )}
              >
                {uploadHero.isPending
                  ? 'Uploading…'
                  : heroImageUrl
                    ? 'Replace image'
                    : 'Upload image'}
              </span>
            </label>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
          <div>
            <Label htmlFor="home-show-logo" className="text-xs font-medium cursor-pointer">
              Workspace logo
            </Label>
            <p className="text-xs text-muted-foreground">
              Show your logo in the Home header (set it under Branding)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={saving} />
            <Switch
              id="home-show-logo"
              checked={home.showLogo ?? true}
              onCheckedChange={(checked) => commit({ showLogo: checked })}
              disabled={isBusy}
              aria-label="Workspace logo"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
          <div>
            <Label htmlFor="home-team-avatars" className="text-xs font-medium cursor-pointer">
              Team avatars
            </Label>
            <p className="text-xs text-muted-foreground">Show teammate faces in the Home header</p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={saving} />
            <Switch
              id="home-team-avatars"
              checked={home.showTeamAvatars ?? true}
              onCheckedChange={(checked) => commit({ showTeamAvatars: checked })}
              disabled={isBusy}
              aria-label="Team avatars"
            />
          </div>
        </div>

        {/* Ordered card list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Home cards</Label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isBusy || cards.length >= 8}
              onClick={() => {
                commitCards([
                  ...cards,
                  {
                    id: `link-${cards.length}-${cards.map((c) => c.id).join('').length}`,
                    type: 'link',
                    title: '',
                    url: '',
                  },
                ])
              }}
            >
              <PlusIcon className="h-3 w-3 mr-1" />
              Add link card
            </Button>
          </div>

          <div className="space-y-2">
            {cards.map((card, index) => (
              <div key={card.id} className="rounded-lg border border-border/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {CARD_TYPE_LABEL[card.type] ?? card.type}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={isBusy || index === 0}
                      onClick={() => moveCard(index, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={isBusy || index === cards.length - 1}
                      onClick={() => moveCard(index, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDownIcon className="h-3 w-3" />
                    </Button>
                    {card.type === 'link' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        disabled={isBusy}
                        onClick={() => commitCards(cards.filter((_, i) => i !== index))}
                        aria-label="Remove card"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Switch
                        checked={card.enabled !== false}
                        onCheckedChange={(checked) => updateCard(index, { enabled: checked })}
                        disabled={isBusy}
                        aria-label={`${CARD_TYPE_LABEL[card.type]} card`}
                        className="ms-1"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Input
                    defaultValue={card.title ?? ''}
                    maxLength={80}
                    placeholder="Title (default)"
                    className="h-8 text-xs"
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value === (card.title ?? '')) return
                      updateCard(index, { title: value || undefined })
                    }}
                    disabled={isBusy}
                  />
                  <Input
                    defaultValue={card.subtitle ?? ''}
                    maxLength={160}
                    placeholder="Subtitle (default)"
                    className="h-8 text-xs"
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value === (card.subtitle ?? '')) return
                      updateCard(index, { subtitle: value || undefined })
                    }}
                    disabled={isBusy}
                  />
                </div>

                {card.type === 'link' && (
                  <Input
                    defaultValue={card.url ?? ''}
                    maxLength={2000}
                    placeholder="https://example.com"
                    className="h-8 text-xs"
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value === (card.url ?? '')) return
                      updateCard(index, { url: value })
                    }}
                    disabled={isBusy}
                  />
                )}

                <Select
                  value={card.audience ?? 'everyone'}
                  onValueChange={(val: WidgetCardAudience) =>
                    updateCard(index, { audience: val === 'everyone' ? undefined : val })
                  }
                  disabled={isBusy}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everyone">Show to everyone</SelectItem>
                    <SelectItem value="anonymous">Signed-out visitors only</SelectItem>
                    <SelectItem value="identified">Signed-in users only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Built-in cards hide automatically when their section is disabled. Custom titles override
            the defaults; leave blank to keep them.
          </p>
        </div>
      </div>
    </SettingsCard>
  )
}

/** Cross-link to the AI & Automation page (assistant identity lives there). */
const TRANSLATABLE_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== 'en')
const LOCALE_LABEL: Record<string, string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
  ru: 'Russian',
  'pt-br': 'Portuguese (Brazil)',
  'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
}
const TRANSLATION_FIELDS: { key: keyof WidgetContentTranslation; placeholder: string }[] = [
  { key: 'welcomeMessage', placeholder: 'Welcome message' },
  { key: 'offlineMessage', placeholder: 'Offline message' },
  { key: 'greeting', placeholder: 'Home greeting' },
  { key: 'subtitle', placeholder: 'Home subtitle' },
]

function WidgetTranslationsCard({ translations }: { translations?: WidgetTranslations }) {
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [draft, setDraft] = useState<WidgetTranslations>(translations ?? {})
  const [saving, setSaving] = useState(false)
  const configured = Object.keys(draft)
  const available = TRANSLATABLE_LOCALES.filter((l) => !configured.includes(l))

  async function commit(next: WidgetTranslations) {
    setDraft(next)
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ translations: next })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Translations"
      description="Localise the customer-facing copy. Visitors see it in their browser language; the default copy is the fallback."
    >
      <div className="space-y-3">
        {configured.length === 0 && (
          <p className="text-xs text-muted-foreground">No translations yet.</p>
        )}
        {configured.map((locale) => (
          <div key={locale} className="space-y-2 rounded-lg border border-border/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{LOCALE_LABEL[locale] ?? locale}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => {
                  const next = { ...draft }
                  delete next[locale]
                  void commit(next)
                }}
                disabled={saving}
              >
                Remove
              </Button>
            </div>
            {TRANSLATION_FIELDS.map((f) => (
              <Input
                key={f.key}
                defaultValue={draft[locale]?.[f.key] ?? ''}
                placeholder={f.placeholder}
                maxLength={1000}
                className="h-8 text-xs"
                disabled={saving}
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (value === (draft[locale]?.[f.key] ?? '')) return
                  const entry: WidgetContentTranslation = {
                    ...(draft[locale] ?? {}),
                    [f.key]: value || undefined,
                  }
                  void commit({ ...draft, [locale]: entry })
                }}
              />
            ))}
          </div>
        ))}
        {available.length > 0 && (
          <Select
            value=""
            onValueChange={(l) => void commit({ ...draft, [l]: {} })}
            disabled={saving}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Add a language" />
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l} value={l}>
                  {LOCALE_LABEL[l] ?? l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </SettingsCard>
  )
}

function AssistantLinkCard({
  assistant,
}: {
  assistant?: { enabled?: boolean; name?: string } | undefined
}) {
  return (
    <SettingsCard title="AI Assistant" description="The assistant that fronts new conversations">
      <Link
        to="/admin/settings/ai"
        className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-3 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SparklesIcon className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-medium text-foreground">
              {assistant?.enabled === false ? 'Assistant off' : assistant?.name?.trim() || 'Quinn'}
            </span>
            <span className="block text-xs text-muted-foreground">
              Configure identity in AI &amp; Automation
            </span>
          </span>
        </span>
        <ArrowRightIcon className="h-4 w-4 text-muted-foreground/50" />
      </Link>
    </SettingsCard>
  )
}

// ==============================================
// Installation Guide -- Interactive Code Panel
// ==============================================

const SERVER_EXAMPLES: {
  id: string
  label: string
  filename: string
  lang: SyntaxLang
  code: string
}[] = [
  {
    id: 'nextjs',
    label: 'Next.js',
    filename: 'route.ts',
    lang: 'js',
    code: `import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function signWidgetToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.QUACKBACK_WIDGET_SECRET!)
    .update(\`\${header}.\${body}\`)
    .digest("base64url");
  return \`\${header}.\${body}.\${signature}\`;
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({}, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const ssoToken = signWidgetToken({
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    // Custom attributes (must be configured in Settings > User Attributes)
    // plan: session.user.plan,
    // mrr: session.user.mrr,
    exp: now + 300,
  });

  return NextResponse.json({ ssoToken });
}`,
  },
  {
    id: 'express',
    label: 'Express',
    filename: 'widget.js',
    lang: 'js',
    code: `import crypto from "crypto";

function signWidgetToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.QUACKBACK_WIDGET_SECRET)
    .update(\`\${header}.\${body}\`)
    .digest("base64url");
  return \`\${header}.\${body}.\${signature}\`;
}

app.post("/api/widget-sso", (req, res) => {
  // req.user set by your auth middleware
  const now = Math.floor(Date.now() / 1000);
  const ssoToken = signWidgetToken({
    sub: req.user.id,
    email: req.user.email,
    name: req.user.name,
    // Custom attributes (must be configured in Settings > User Attributes)
    // plan: req.user.plan,
    exp: now + 300,
  });

  res.json({ ssoToken });
});`,
  },
  {
    id: 'django',
    label: 'Django',
    filename: 'views.py',
    lang: 'python',
    code: `import base64, hashlib, hmac, json, time
from django.conf import settings
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def sign_widget_token(payload):
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64url(json.dumps(payload).encode())
    sig = hmac.new(
        settings.QUACKBACK_WIDGET_SECRET.encode(),
        f"{header}.{body}".encode(),
        hashlib.sha256,
    ).digest()
    return f"{header}.{body}.{b64url(sig)}"

@login_required
def widget_sso(request):
    now = int(time.time())
    token = sign_widget_token({
        "sub": str(request.user.id),
        "email": request.user.email,
        "name": request.user.get_full_name() or request.user.username,
        # Custom attributes (must be configured in Settings > User Attributes)
        # "plan": request.user.plan,
        "exp": now + 300,
    })
    return JsonResponse({"ssoToken": token})`,
  },
  {
    id: 'rails',
    label: 'Rails',
    filename: 'widget_controller.rb',
    lang: 'ruby',
    code: `require "base64"
require "json"
require "openssl"

class Api::WidgetController < ApplicationController
  before_action :authenticate_user!

  def identify_sso
    now = Time.now.to_i
    payload = {
      sub: current_user.id.to_s,
      email: current_user.email,
      name: current_user.name,
      exp: now + 300,
    }

    render json: { ssoToken: sign_widget_token(payload) }
  end

  private

  def sign_widget_token(payload)
    header = Base64.urlsafe_encode64({ alg: "HS256", typ: "JWT" }.to_json, padding: false)
    body = Base64.urlsafe_encode64(payload.to_json, padding: false)
    sig = OpenSSL::HMAC.digest("sha256", ENV["QUACKBACK_WIDGET_SECRET"], "#{header}.#{body}")
    "#{header}.#{body}.#{Base64.urlsafe_encode64(sig, padding: false)}"
  end
end`,
  },
  {
    id: 'laravel',
    label: 'Laravel',
    filename: 'WidgetController.php',
    lang: 'php',
    code: `use Illuminate\\Http\\Request;

class WidgetController extends Controller
{
    public function identifySso(Request $request)
    {
        $now = time();
        $payload = [
            "sub" => (string) $request->user()->id,
            "email" => $request->user()->email,
            "name" => $request->user()->name,
            "exp" => $now + 300,
        ];

        return response()->json(["ssoToken" => $this->signWidgetToken($payload)]);
    }

    private function signWidgetToken(array $payload): string
    {
        $header = rtrim(strtr(base64_encode(json_encode(["alg" => "HS256", "typ" => "JWT"])), "+/", "-_"), "=");
        $body = rtrim(strtr(base64_encode(json_encode($payload)), "+/", "-_"), "=");
        $signature = hash_hmac(
            "sha256",
            $header . "." . $body,
            config("services.quackback.widget_secret"),
            true,
        );

        return $header . "." . $body . "." . rtrim(strtr(base64_encode($signature), "+/", "-_"), "=");
    }
}`,
  },
]

const CLIENT_CODE_IDENTIFY = `import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export function WidgetIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    fetch("/api/widget-sso", { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch widget token");
        return res.json();
      })
      .then(({ ssoToken }) => {
        Quackback("identify", { ssoToken });
      });
  }, [user]);

  return null;
}`

interface CodeTab {
  id: string
  label: string
  lang: SyntaxLang
  code: string
}

function WidgetInstallation({ secret, baseUrl }: { secret: string | null; baseUrl: string }) {
  const [, startTransition] = useTransition()
  const regenerateSecret = useRegenerateWidgetSecret()
  const router = useRouter()

  // Guide UI state
  const [framework, setFramework] = useState('nextjs')
  const [activeTab, setActiveTab] = useState('snippet')

  const [currentSecret, setCurrentSecret] = useState(secret)
  const [secretVisible, setSecretVisible] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const installSnippet = useMemo(
    () =>
      `<script>
  (function(w,d){if(w.Quackback)return;w.Quackback=function(){
  (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.src="${baseUrl}/api/widget/sdk.js";
  d.head.appendChild(s)})(window,document);

  Quackback("init");
</script>`,
    [baseUrl]
  )

  // Identify is verified-only: the guide always shows the backend signer.
  const tabs = useMemo<CodeTab[]>(() => {
    const t: CodeTab[] = [
      { id: 'snippet', label: 'snippet.html', lang: 'js', code: installSnippet },
    ]
    const ex = SERVER_EXAMPLES.find((e) => e.id === framework)
    if (ex) {
      t.push({ id: 'server', label: ex.filename, lang: ex.lang, code: ex.code })
    }
    t.push({ id: 'client', label: 'identify.tsx', lang: 'js', code: CLIENT_CODE_IDENTIFY })
    return t
  }, [installSnippet, framework])

  // Reset active tab if it's no longer available
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab('snippet')
    }
  }, [tabs, activeTab])

  const activeTabData = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  async function handleCopySecret() {
    if (!currentSecret) return
    await navigator.clipboard.writeText(currentSecret)
    setCopiedSecret(true)
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  async function handleCopyCode() {
    await navigator.clipboard.writeText(activeTabData.code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      const newSecret = await regenerateSecret.mutateAsync()
      setCurrentSecret(newSecret)
      startTransition(() => router.invalidate())
    } finally {
      setRegenerating(false)
    }
  }

  const maskedSecret = currentSecret
    ? currentSecret.slice(0, 8) + '•'.repeat(Math.max(0, currentSecret.length - 8))
    : null

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[480px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] flex-1">
        {/* Left: Configuration */}
        <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border divide-y divide-border">
          {/* Header */}
          <div className="p-5">
            <h3 className="text-sm font-semibold text-foreground">Installation</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure and add the widget to your site
            </p>
          </div>

          {/* Step 1 */}
          <div className="p-5 space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                1
              </span>
              <span className="text-xs font-medium text-foreground">Add the script</span>
            </div>
            <p className="text-xs text-muted-foreground ml-7">
              Paste before the closing <code className="text-xs">&lt;/body&gt;</code> tag
            </p>
          </div>

          {/* Step 2 */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                2
              </span>
              <div>
                <span className="text-xs font-medium text-foreground">Identify users</span>
                <p className="text-xs text-muted-foreground">Required to display the widget</p>
              </div>
            </div>

            <div className="ml-7 space-y-3">
              <p className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded px-2 py-1.5 leading-relaxed">
                Users are identified with an ssoToken your backend signs using the widget secret.
                Visitors without one browse anonymously — nobody can claim an email they don&apos;t
                own.
              </p>

              <div className="space-y-2.5">
                {/* Framework */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Backend framework</Label>
                  <Select value={framework} onValueChange={setFramework}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVER_EXAMPLES.map((ex) => (
                        <SelectItem key={ex.id} value={ex.id}>
                          {ex.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Secret */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Widget secret</Label>
                  {currentSecret ? (
                    <div className="flex items-center gap-1">
                      <code className="flex-1 text-xs font-mono text-foreground bg-muted/30 border border-border/50 rounded px-2 py-1 truncate">
                        {secretVisible ? currentSecret : maskedSecret}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => setSecretVisible(!secretVisible)}
                      >
                        {secretVisible ? (
                          <EyeSlashIcon className="h-3 w-3" />
                        ) : (
                          <EyeIcon className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={handleCopySecret}
                      >
                        {copiedSecret ? (
                          <CheckIcon className="h-3 w-3 text-green-500" />
                        ) : (
                          <ClipboardDocumentIcon className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Click regenerate to create a secret
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                  >
                    {regenerating ? (
                      <>
                        <ArrowPathIcon className="h-3 w-3 animate-spin mr-1" />
                        Regenerating...
                      </>
                    ) : (
                      'Regenerate'
                    )}
                  </Button>
                </div>

                {/* Security note */}
                <WarningBox variant="warning" title="Keep this secret server-side only" />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dynamic Code Panel */}
        <div className="flex flex-col">
          {/* File tabs */}
          <div
            className="flex items-center justify-between shrink-0 px-1"
            style={{ backgroundColor: '#252526' }}
          >
            <div className="flex items-center">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-3 py-2 text-[11px] font-mono transition-colors border-b-2',
                    activeTab === tab.id
                      ? 'text-white/90 border-primary'
                      : 'text-white/40 border-transparent hover:text-white/60'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex items-center gap-1 px-2.5 py-1.5 mr-1 rounded text-[11px] text-white/40 hover:text-white/70 transition-colors"
            >
              {copiedCode ? (
                <>
                  <CheckIcon className="h-3 w-3 text-green-400" />
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <ClipboardDocumentIcon className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Code display */}
          <div className="flex-1 overflow-auto">
            <HighlightedCode code={activeTabData.code} lang={activeTabData.lang} />
          </div>
        </div>
      </div>
    </div>
  )
}
