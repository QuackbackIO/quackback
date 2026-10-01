import { useRouter, useHydrated, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { SparklesIcon, TrashIcon, ArrowRightIcon, PhotoIcon } from '@heroicons/react/24/solid'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { StateBadge } from '@/components/shared/state-badge'
import { SettingsList, SettingsListRow, RowIcon } from '@/components/admin/settings/settings-list'
import {
  WidgetConnectionRow,
  type WidgetConnectionStatus,
} from '@/components/admin/settings/widget/widget-connection-row'
import { HomeCardsList } from '@/components/admin/settings/widget/home-cards-list'
import { WidgetPreview } from '@/components/admin/settings/widget/widget-preview'
import { PreviewToggleButton } from '@/components/admin/settings/preview-toggle'
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
  useUploadWidgetHeroImage,
  useDeleteWidgetHeroImage,
} from '@/lib/client/mutations/settings'
import type { FeatureFlags, WidgetHomeCard, WidgetHomeConfig } from '@/lib/shared/types/settings'
import { widgetInstallPresence } from '@/lib/shared/widget/widget-origin'
import { DEFAULT_WIDGET_HOME_CARDS } from '@/lib/shared/types/settings'
import { WIDGET_HERO_PATTERNS, heroBackdropStyle } from '@/lib/shared/widget/hero-style'
import { ColorPickerGrid, ColorHexInput } from '@/components/shared/color-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

export function WidgetSettingsGate() {
  const childMatches = useChildMatches()
  if (childMatches.length > 0) return <Outlet />
  return <WidgetSettingsPage />
}

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  // The install status the page was delivered with stays fresh for a few
  // seconds, so a hydration that takes a moment does not fetch it again.
  const onboardingQuery = useSuspenseQuery({
    ...adminQueries.onboardingStatus(),
    staleTime: 5_000,
  })
  const settings = useWorkspaceSettings()

  const flags = settings?.featureFlags as FeatureFlags | undefined
  const config = widgetConfigQuery.data

  const helpCenterFlagEnabled = flags?.helpCenter ?? false
  const supportInboxFlagEnabled = flags?.supportInbox ?? false
  const feedbackFlagEnabled = flags?.feedback ?? true
  const changelogFlagEnabled = flags?.changelog ?? true
  const supportTicketsFlagEnabled = flags?.supportTickets ?? false

  // Lifted editor state: position drives the preview's launcher chrome.
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    (config.position as 'bottom-right' | 'bottom-left') ?? 'bottom-right'
  )
  // Draft label: mirrors into the preview live; persisted on blur.
  const [launcherLabel, setLauncherLabel] = useState(config.launcherLabel ?? '')
  const [launcherGreeting, setLauncherGreeting] = useState(config.launcherGreeting ?? '')
  const [homeDraft, setHomeDraft] = useState<WidgetHomeConfig>(config.home ?? {})

  // The preview iframe shows the persisted config; remount it whenever a save
  // lands. Keyed on content (not dataUpdatedAt) so refetches that return
  // identical data don't cause gratuitous reloads.
  const previewRefreshKey = useMemo(() => JSON.stringify(config), [config])

  return (
    <SettingsPage page="/admin/settings/widget" width="wide">
      {/* Full-screen editor: controls left, live preview right (sticky). */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <VisibilityCard initialEnabled={config.enabled} status={onboardingQuery.data} />

          <TabsCard
            config={config}
            boards={boardsQuery.data}
            helpCenterFlagEnabled={helpCenterFlagEnabled}
            supportInboxFlagEnabled={supportInboxFlagEnabled}
            feedbackFlagEnabled={feedbackFlagEnabled}
            changelogFlagEnabled={changelogFlagEnabled}
            supportTicketsFlagEnabled={supportTicketsFlagEnabled}
          />

          <LayoutCard
            config={config}
            position={position}
            onPositionChange={setPosition}
            launcherLabel={launcherLabel}
            onLabelChange={setLauncherLabel}
            launcherGreeting={launcherGreeting}
            onGreetingChange={setLauncherGreeting}
          />

          <HomeCustomizationCard
            home={homeDraft}
            heroImageUrl={config.home?.heroImageUrl ?? null}
            onHomeChange={setHomeDraft}
          />

          <AssistantLinkCard assistant={config.messenger?.assistant} />
        </div>

        <WidgetPreviewColumn
          position={position}
          label={launcherLabel.trim() || undefined}
          greeting={launcherGreeting.trim() || undefined}
          refreshKey={previewRefreshKey}
        />
      </div>
    </SettingsPage>
  )
}

/**
 * The live preview column. It owns the preview's theme and its wait for
 * hydration, so the preview appearing re-renders this column alone rather
 * than every settings card beside it.
 */
function WidgetPreviewColumn({
  position,
  label,
  greeting,
  refreshKey,
}: {
  position: 'bottom-right' | 'bottom-left'
  label?: string
  greeting?: string
  refreshKey: string
}) {
  // The preview theme follows the admin's own theme until the toggle overrides
  // it. resolvedTheme must not affect render output until hydration is done:
  // SSR renders it as undefined but the client hydrates with the real value,
  // and React doesn't patch attribute mismatches during hydration, so the
  // toggle would keep its stale server-rendered active state forever. Gating
  // on hydration keeps it consistent (and holds the iframe back one tick
  // instead of flashing a light widget at dark users and reloading).
  const { resolvedTheme } = useTheme()
  const hydrated = useHydrated()
  const [previewThemeOverride, setPreviewThemeOverride] = useState<'light' | 'dark' | null>(null)
  const previewTheme =
    previewThemeOverride ?? (hydrated && resolvedTheme === 'dark' ? 'dark' : 'light')

  return (
    <div className="xl:sticky xl:top-6 min-w-0 xl:h-[calc(100vh-7.5rem)] flex flex-col">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium">Live preview</span>
        <div className="ms-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <PreviewToggleButton
            active={previewTheme === 'light'}
            onClick={() => setPreviewThemeOverride('light')}
            label="Light"
          />
          <PreviewToggleButton
            active={previewTheme === 'dark'}
            onClick={() => setPreviewThemeOverride('dark')}
            label="Dark"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {hydrated && (
          <WidgetPreview
            position={position}
            label={label}
            greeting={greeting}
            theme={previewTheme}
            refreshKey={refreshKey}
          />
        )}
      </div>
    </div>
  )
}

function VisibilityCard({
  initialEnabled,
  status,
}: {
  initialEnabled: boolean
  status: WidgetConnectionStatus
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const presence = widgetInstallPresence({
    connected: Boolean(status.hasWidgetInstalled),
    enabled,
    originHost: status.widgetOriginHost,
  })
  const idle = presence.tone === 'idle'

  async function handleToggle(checked: boolean) {
    const previous = enabled
    setEnabled(checked)
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ enabled: checked })
      startTransition(() => router.invalidate())
    } catch {
      setEnabled(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Visibility"
      action={
        <Button asChild size="sm" variant={idle ? 'default' : 'outline'} className="shrink-0">
          <Link to="/admin/settings/widget/install">
            {idle ? 'Set it up' : 'View installation'}
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </Button>
      }
    >
      <SettingRows>
        <SettingRow
          label="Show on your website"
          description="Visitors see the launcher on pages where you added it."
          htmlFor="widget-toggle"
          control={
            <Switch
              id="widget-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={saving || isPending}
            />
          }
        />
        <WidgetConnectionRow label="Install status" status={status} enabled={enabled} />
      </SettingRows>
    </SettingsCard>
  )
}

export function TabsCard({
  config,
  boards,
  helpCenterFlagEnabled,
  supportInboxFlagEnabled,
  feedbackFlagEnabled,
  changelogFlagEnabled,
  supportTicketsFlagEnabled,
}: {
  config: {
    defaultBoard?: string
    tabs?: {
      feedback?: boolean
      changelog?: boolean
      help?: boolean
      messenger?: boolean
      tickets?: boolean
      home?: boolean
    }
  }
  boards: { id: string; name: string; slug: string }[]
  helpCenterFlagEnabled: boolean
  supportInboxFlagEnabled: boolean
  feedbackFlagEnabled: boolean
  changelogFlagEnabled: boolean
  supportTicketsFlagEnabled: boolean
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [tabs, setTabs] = useState({
    home: config.tabs?.home ?? true,
    messenger: config.tabs?.messenger ?? true,
    tickets: config.tabs?.tickets ?? true,
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? true,
    help: config.tabs?.help ?? false,
  })

  const showHelpToggle = helpCenterFlagEnabled
  const showMessagesToggle = supportInboxFlagEnabled
  const showTicketsToggle = supportTicketsFlagEnabled
  const bothContentProductsOn = feedbackFlagEnabled && changelogFlagEnabled
  const contentSectionCount = [
    feedbackFlagEnabled && tabs.feedback,
    changelogFlagEnabled && tabs.changelog,
    helpCenterFlagEnabled && tabs.help,
    supportInboxFlagEnabled && tabs.messenger,
    supportTicketsFlagEnabled && tabs.tickets,
  ].filter(Boolean).length
  const lastSectionLock = contentSectionCount <= 1
  const lockFeedbackOff =
    tabs.feedback && (bothContentProductsOn ? !tabs.changelog : lastSectionLock)
  const lockChangelogOff =
    tabs.changelog && (bothContentProductsOn ? !tabs.feedback : lastSectionLock)
  const pairLockHint = (other: string) =>
    `At least one of Feedback or Changelog stays on. Turn on ${other} to turn this off.`
  const lastSectionHint = 'The widget needs at least one section.'

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

  /** Persist one tab flag, reverting local state on error. */
  async function saveTab(key: keyof typeof tabs, checked: boolean) {
    const prev = tabs[key]
    setTabs({ ...tabs, [key]: checked })
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ tabs: { [key]: checked } })
      startTransition(() => router.invalidate())
    } catch {
      setTabs({ ...tabs, [key]: prev })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="Tabs"
      description="Choose which tabs the widget shows. The tab bar hides with a single section."
    >
      <SettingRows>
        <TabRow
          id="tab-home"
          label="Home"
          description="Greets users and links to your sections. Appears when two or more sections are on."
          checked={tabs.home}
          disabled={isBusy}
          onChange={(checked) => void saveTab('home', checked)}
        />

        {showMessagesToggle && (
          <TabRow
            id="tab-messages"
            label="Messages"
            description="Live chat conversations"
            checked={tabs.messenger}
            disabled={isBusy || (tabs.messenger && lastSectionLock)}
            disabledHint={lastSectionHint}
            onChange={(checked) => {
              if (!checked && lastSectionLock) return
              void saveTab('messenger', checked)
            }}
          />
        )}

        {showTicketsToggle && (
          <TabRow
            id="tab-tickets"
            label="Tickets"
            description="Shown only when a customer has tickets"
            checked={tabs.tickets}
            disabled={isBusy || (tabs.tickets && lastSectionLock)}
            disabledHint={lastSectionHint}
            onChange={(checked) => {
              if (!checked && lastSectionLock) return
              void saveTab('tickets', checked)
            }}
          />
        )}

        {feedbackFlagEnabled && (
          <TabRow
            id="tab-feedback"
            label="Feedback"
            description="Search, vote and submit ideas"
            checked={tabs.feedback}
            disabled={isBusy || lockFeedbackOff}
            disabledHint={bothContentProductsOn ? pairLockHint('Changelog') : lastSectionHint}
            onChange={(checked) => {
              if (!checked && lockFeedbackOff) return
              void saveTab('feedback', checked)
            }}
          />
        )}

        {showHelpToggle && (
          <TabRow
            id="tab-help"
            label="Help"
            description="Browse and search Help Center articles"
            checked={tabs.help}
            disabled={isBusy || (tabs.help && lastSectionLock)}
            disabledHint={lastSectionHint}
            onChange={(checked) => {
              if (!checked && lastSectionLock) return
              void saveTab('help', checked)
            }}
          />
        )}

        {changelogFlagEnabled && (
          <TabRow
            id="tab-changelog"
            label="Changelog"
            description="Show product updates and shipped features"
            checked={tabs.changelog}
            disabled={isBusy || lockChangelogOff}
            disabledHint={bothContentProductsOn ? pairLockHint('Feedback') : lastSectionHint}
            onChange={(checked) => {
              if (!checked && lockChangelogOff) return
              void saveTab('changelog', checked)
            }}
          />
        )}
      </SettingRows>

      {feedbackFlagEnabled && (
        <div className="mt-4 space-y-2 border-t border-border/50 pt-4">
          <Label className="text-[13px] font-medium">Default board</Label>
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
          <p className="text-[13px] text-muted-foreground">
            Which board new posts from the widget default to.
          </p>
        </div>
      )}
    </SettingsCard>
  )
}

export function LayoutCard({
  config,
  position,
  onPositionChange,
  launcherLabel,
  onLabelChange,
  launcherGreeting,
  onGreetingChange,
}: {
  config: {
    launcherGreeting?: string
    launcherLabel?: string
  }
  position: 'bottom-right' | 'bottom-left'
  onPositionChange: (val: 'bottom-right' | 'bottom-left') => void
  launcherLabel: string
  onLabelChange: (val: string) => void
  launcherGreeting: string
  onGreetingChange: (val: string) => void
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
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

  return (
    <SettingsCard
      title="Layout"
      description="Where the launcher sits and what it says on your site."
    >
      <div className="space-y-2">
        <Label htmlFor="widget-position" className="text-[13px] font-medium">
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
          <SelectTrigger id="widget-position" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom-right">Bottom right</SelectItem>
            <SelectItem value="bottom-left">Bottom left</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="launcher-label" className="text-[13px] font-medium">
          Button label
        </Label>
        <Input
          id="launcher-label"
          value={launcherLabel}
          maxLength={60}
          placeholder="e.g. Chat with us"
          disabled={isBusy}
          onChange={(e) => onLabelChange(e.target.value)}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value === (config.launcherLabel ?? '')) return
            void save({ launcherLabel: value })
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          Text next to the icon on the launcher button. Leave blank for the icon-only circle.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="launcher-greeting" className="text-[13px] font-medium">
          Launcher greeting
        </Label>
        <Input
          id="launcher-greeting"
          value={launcherGreeting}
          maxLength={120}
          placeholder="e.g. Need a hand?"
          disabled={isBusy}
          onChange={(e) => onGreetingChange(e.target.value)}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value === (config.launcherGreeting ?? '')) return
            void save({ launcherGreeting: value })
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          Shown in a bubble beside the launcher to invite a chat. Leave blank for none.
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
  disabledHint,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  /** Why the switch is locked, shown as a tooltip so an inert control never
   *  reads as broken. */
  disabledHint?: string
  onChange: (checked: boolean) => void
}) {
  const showHint = disabled && !!disabledHint
  const switchControl = (
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={`${label} tab`}
      // Disabled controls swallow pointer events, which would keep the
      // wrapper tooltip from ever opening; route them to the span instead.
      className={showHint ? 'pointer-events-none' : undefined}
    />
  )
  return (
    <SettingRow
      label={label}
      description={description}
      htmlFor={id}
      control={
        showHint ? (
          <TooltipProvider delay={200}>
            <Tooltip>
              {/* span trigger so the tooltip works over a disabled control */}
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-full">
                  {switchControl}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{disabledHint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          switchControl
        )
      }
    />
  )
}

/**
 * One hero color slot: a swatch that opens the shared picker. Empty means
 * "brand color", shown as a primary-tinted swatch with a dashed ring so it
 * reads as inherited rather than chosen.
 */
function HeroColorSwatch({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value?: string
  disabled?: boolean
  onChange: (color: string) => void
}) {
  const isCustom = !!value
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50"
        >
          <span
            className={cn(
              'size-4 rounded-full border',
              isCustom ? 'border-border/50' : 'border-dashed border-muted-foreground/50 bg-primary'
            )}
            style={isCustom ? { backgroundColor: value } : undefined}
            aria-hidden
          />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto space-y-2 p-3" align="start">
        <ColorPickerGrid selectedColor={value ?? ''} onColorChange={onChange} />
        <ColorHexInput color={value ?? ''} onColorChange={onChange} />
      </PopoverContent>
    </Popover>
  )
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

  return (
    <SettingsCard title="Home" description="The greeting, header and cards shown on the Home tab.">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="home-greeting" className="text-[13px] font-medium">
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
            name.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="home-subtitle" className="text-[13px] font-medium">
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
          <Label className="text-[13px] font-medium">Background</Label>
          {/* Visual radio tiles: every style is visible at a glance (no
              dropdown to open), and the options panel below reads as attached
              to the selected tile: one bordered group, morphing per choice. */}
          <div role="radiogroup" aria-label="Home background style">
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { id: 'plain', name: 'Plain' },
                  { id: 'gradient', name: 'Gradient' },
                  { id: 'pattern', name: 'Pattern' },
                  { id: 'image', name: 'Image' },
                ] as const
              ).map((tile) => {
                const active = (home.headerStyle ?? 'plain') === tile.id
                return (
                  <button
                    key={tile.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={isBusy}
                    onClick={() => commit({ headerStyle: tile.id })}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs transition-colors',
                      active
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    {tile.id === 'image' ? (
                      heroImageUrl ? (
                        <img
                          src={heroImageUrl}
                          alt=""
                          className="h-10 w-full rounded-md border border-border/40 object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/40">
                          <PhotoIcon className="size-4 text-muted-foreground/60" />
                        </span>
                      )
                    ) : (
                      <span
                        className="h-10 w-full rounded-md border border-border/40 bg-background"
                        style={
                          heroBackdropStyle({
                            headerStyle: tile.id,
                            pattern: home.pattern,
                            gradient: home.gradient,
                          }) ?? undefined
                        }
                        aria-hidden
                      />
                    )}
                    <span className="text-muted-foreground">{tile.name}</span>
                  </button>
                )
              })}
            </div>

            {home.headerStyle === 'pattern' && (
              <div className="mt-3 space-y-1.5">
                <Label className="text-[13px] font-medium">Pattern</Label>
                <div className="grid grid-cols-4 gap-2">
                  {WIDGET_HERO_PATTERNS.map((preset) => {
                    const active = (home.pattern ?? 'mesh') === preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isBusy}
                        onClick={() => commit({ pattern: preset.id })}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs transition-colors',
                          active
                            ? 'border-primary ring-1 ring-primary'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <span
                          className="h-8 w-full rounded-md bg-background"
                          style={
                            heroBackdropStyle({
                              headerStyle: 'pattern',
                              pattern: preset.id,
                              gradient: home.gradient,
                            }) ?? undefined
                          }
                          aria-hidden
                        />
                        <span className="text-muted-foreground">{preset.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {(home.headerStyle === 'gradient' || home.headerStyle === 'pattern') && (
              <div className="mt-3 space-y-1.5">
                <Label className="text-[13px] font-medium">Colors</Label>
                <div className="flex items-center gap-2">
                  <HeroColorSwatch
                    label="From"
                    value={home.gradient?.from}
                    disabled={isBusy}
                    onChange={(color) => commit({ gradient: { ...home.gradient, from: color } })}
                  />
                  <HeroColorSwatch
                    label="To"
                    value={home.gradient?.to}
                    disabled={isBusy}
                    onChange={(color) => commit({ gradient: { ...home.gradient, to: color } })}
                  />
                  {(home.gradient?.from || home.gradient?.to) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={isBusy}
                      onClick={() => commit({ gradient: { from: '', to: '' } })}
                    >
                      Use brand color
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A backdrop for the Home tab that fades into the background.
          </p>
        </div>

        {home.headerStyle === 'image' && (
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
                Upload an image to fill the open widget (recommended ~800×1400px, portrait). It
                covers the full panel.
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

        <SettingRows className="border-t border-border/50 pt-4">
          <SettingRow
            label="Workspace logo"
            description="Show your logo in the Home header (set under General)."
            htmlFor="home-show-logo"
            control={
              <Switch
                id="home-show-logo"
                checked={home.showLogo ?? true}
                onCheckedChange={(checked) => commit({ showLogo: checked })}
                disabled={isBusy}
              />
            }
          />
          <SettingRow
            label="Team avatars"
            description="Show teammate faces in the Home header."
            htmlFor="home-team-avatars"
            control={
              <Switch
                id="home-team-avatars"
                checked={home.showTeamAvatars ?? true}
                onCheckedChange={(checked) => commit({ showTeamAvatars: checked })}
                disabled={isBusy}
              />
            }
          />
        </SettingRows>

        <HomeCardsList cards={cards} onChange={commitCards} disabled={isBusy} />
      </div>
    </SettingsCard>
  )
}

export function AssistantLinkCard({
  assistant,
}: {
  assistant?: { enabled?: boolean; respond?: boolean; name?: string } | undefined
}) {
  const off = assistant?.enabled === false
  // Paused: switched on but not replying (the Agent page's Pause control).
  const paused = !off && assistant?.respond === false
  return (
    <SettingsCard flush>
      <SettingsList>
        <SettingsListRow
          to="/admin/settings/agent"
          leading={<RowIcon icon={SparklesIcon} />}
          title="Quinn"
          badges={
            off ? <StateBadge state="off" /> : paused ? <StateBadge state="paused" /> : undefined
          }
          meta={
            off
              ? 'Turn it on in AI & Automation'
              : paused
                ? 'Resume it in AI & Automation'
                : 'Configure in AI & Automation'
          }
        />
      </SettingsList>
    </SettingsCard>
  )
}
