import {
  createFileRoute,
  useRouter,
  useRouteContext,
  Link,
  Outlet,
  useChildMatches,
} from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo, useEffect, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  SunIcon,
  MoonIcon,
  TrashIcon,
  PlusIcon,
  ArrowRightIcon,
  PhotoIcon,
  Bars3Icon,
} from '@heroicons/react/24/solid'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WidgetPreview } from '@/components/admin/settings/widget/widget-preview'
import { WidgetLastDetected } from '@/components/admin/settings/widget/widget-last-detected'
import { PreviewToggleButton } from '@/components/admin/settings/preview-toggle'
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
import {
  WIDGET_LOCALE_LABELS,
  type WidgetContentTranslation,
  type WidgetTranslations,
} from '@/lib/shared/widget/translations'
import { widgetInstallPresence } from '@/lib/shared/widget/widget-origin'
import {
  widgetConnectedStatusLabel,
  widgetSdkUpdateDescription,
} from '@/lib/shared/widget/sdk-version'
import { DEFAULT_WIDGET_HOME_CARDS } from '@/lib/shared/types/settings'
import { WIDGET_HERO_PATTERNS, heroBackdropStyle } from '@/lib/shared/widget/hero-style'
import { ColorPickerGrid, ColorHexInput } from '@/components/shared/color-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export const Route = createFileRoute('/admin/settings/widget')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.onboardingStatus()),
    ])

    return {}
  },
  component: WidgetSettingsGate,
})

export function WidgetSettingsGate() {
  const childMatches = useChildMatches()
  if (childMatches.length > 0) return <Outlet />
  return <WidgetSettingsPage />
}

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const onboardingQuery = useSuspenseQuery(adminQueries.onboardingStatus())
  const { settings } = useRouteContext({ from: '__root__' })

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
  // Draft label — mirrors into the preview live; persisted on blur.
  const [launcherLabel, setLauncherLabel] = useState(config.launcherLabel ?? '')
  const [launcherGreeting, setLauncherGreeting] = useState(config.launcherGreeting ?? '')
  const [homeDraft, setHomeDraft] = useState<WidgetHomeConfig>(config.home ?? {})

  // The preview theme follows the admin's own theme until the toggle overrides
  // it. resolvedTheme must not affect render output before the mount effect:
  // SSR renders it as undefined but the client hydrates with the real value,
  // and React doesn't patch attribute mismatches during hydration, so the
  // toggle would keep its stale server-rendered active state forever. Gating
  // on mounted keeps hydration consistent (and holds the iframe back one tick
  // instead of flashing a light widget at dark users and reloading).
  const { resolvedTheme } = useTheme()
  const [previewThemeOverride, setPreviewThemeOverride] = useState<'light' | 'dark' | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const previewTheme =
    previewThemeOverride ?? (mounted && resolvedTheme === 'dark' ? 'dark' : 'light')

  // The preview iframe shows the persisted config; remount it whenever a save
  // lands. Keyed on content (not dataUpdatedAt) so refetches that return
  // identical data don't cause gratuitous reloads.
  const previewRefreshKey = useMemo(() => JSON.stringify(config), [config])

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
          <WidgetSiteCard initialEnabled={config.enabled} status={onboardingQuery.data} />

          <ModulesCard
            config={config}
            boards={boardsQuery.data}
            position={position}
            onPositionChange={setPosition}
            launcherLabel={launcherLabel}
            onLabelChange={setLauncherLabel}
            launcherGreeting={launcherGreeting}
            onGreetingChange={setLauncherGreeting}
            helpCenterFlagEnabled={helpCenterFlagEnabled}
            supportInboxFlagEnabled={supportInboxFlagEnabled}
            feedbackFlagEnabled={feedbackFlagEnabled}
            changelogFlagEnabled={changelogFlagEnabled}
            supportTicketsFlagEnabled={supportTicketsFlagEnabled}
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
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-medium">Live preview</span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              the real widget — content and actions are real
            </span>
            <div className="ms-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
              <PreviewToggleButton
                active={previewTheme === 'light'}
                onClick={() => setPreviewThemeOverride('light')}
                icon={SunIcon}
                label="Light"
              />
              <PreviewToggleButton
                active={previewTheme === 'dark'}
                onClick={() => setPreviewThemeOverride('dark')}
                icon={MoonIcon}
                label="Dark"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0">
            {mounted && (
              <WidgetPreview
                position={position}
                label={launcherLabel.trim() || undefined}
                greeting={launcherGreeting.trim() || undefined}
                theme={previewTheme}
                refreshKey={previewRefreshKey}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WidgetSiteCard({
  initialEnabled,
  status,
}: {
  initialEnabled: boolean
  status: {
    hasWidgetInstalled?: boolean
    widgetOriginHost?: string | null
    widgetLastDetectedAt?: string | null
    widgetSdkVersion?: string | null
    currentWidgetSdkVersion?: string
    widgetSdkNeedsUpdate?: boolean
  }
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
  const needsUpdate = Boolean(status.hasWidgetInstalled && status.widgetSdkNeedsUpdate)
  const statusTitle = needsUpdate
    ? widgetConnectedStatusLabel({
        hasWidgetInstalled: true,
        widgetSdkNeedsUpdate: true,
      })
    : presence.title
  const statusDescription = needsUpdate
    ? widgetSdkUpdateDescription(status.widgetSdkVersion, status.currentWidgetSdkVersion)
    : presence.description
  const statusTone = needsUpdate ? 'detected' : presence.tone

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
      title="Add to your site"
      description="Show Quackback on your product so customers can send feedback and messages"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
          <div className="min-w-0 pe-3">
            <Label htmlFor="widget-toggle" className="text-xs font-medium cursor-pointer">
              Show on your website
            </Label>
            <p className="text-xs text-muted-foreground">Visible on pages that include the SDK</p>
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

        <div className="rounded-lg border border-border/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-xs font-medium">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  statusTone === 'live'
                    ? 'bg-emerald-500'
                    : statusTone === 'detected'
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground/40'
                )}
              />
              {statusTitle}
            </p>
            <Button asChild size="sm" variant="ghost" className="shrink-0">
              <Link to="/admin/settings/widget/install">
                {presence.tone === 'idle' ? 'Install widget' : 'View installation'}
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{statusDescription}</p>
          {status.hasWidgetInstalled && <WidgetLastDetected at={status.widgetLastDetectedAt} />}
        </div>
      </div>
    </SettingsCard>
  )
}

export function ModulesCard({
  config,
  boards,
  position,
  onPositionChange,
  launcherLabel,
  onLabelChange,
  launcherGreeting,
  onGreetingChange,
  helpCenterFlagEnabled,
  supportInboxFlagEnabled,
  feedbackFlagEnabled,
  changelogFlagEnabled,
  supportTicketsFlagEnabled,
}: {
  config: {
    defaultBoard?: string
    launcherGreeting?: string
    launcherLabel?: string
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
  launcherLabel: string
  onLabelChange: (val: string) => void
  launcherGreeting: string
  onGreetingChange: (val: string) => void
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
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? true,
    help: config.tabs?.help ?? false,
  })

  const showHelpToggle = helpCenterFlagEnabled
  const bothContentProductsOn = feedbackFlagEnabled && changelogFlagEnabled
  const contentSectionCount = [
    feedbackFlagEnabled && tabs.feedback,
    changelogFlagEnabled && tabs.changelog,
    helpCenterFlagEnabled && tabs.help,
    supportInboxFlagEnabled && tabs.messenger,
    supportTicketsFlagEnabled,
  ].filter(Boolean).length
  const lastSectionLock = contentSectionCount <= 1
  const lockFeedbackOff =
    tabs.feedback && (bothContentProductsOn ? !tabs.changelog : lastSectionLock)
  const lockChangelogOff =
    tabs.changelog && (bothContentProductsOn ? !tabs.feedback : lastSectionLock)
  const pairLockHint = (other: string) =>
    `At least one of Feedback or Changelog stays on — enable ${other} to turn this off.`
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

        {feedbackFlagEnabled && (
          <TabRow
            id="tab-feedback"
            label="Feedback"
            description="Search, vote, and submit ideas"
            checked={tabs.feedback}
            disabled={isBusy || lockFeedbackOff}
            disabledHint={bothContentProductsOn ? pairLockHint('Changelog') : lastSectionHint}
            saving={saving}
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
            description="Browse and search help center articles"
            checked={tabs.help}
            disabled={isBusy || (tabs.help && lastSectionLock)}
            disabledHint={lastSectionHint}
            saving={saving}
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
            saving={saving}
            onChange={(checked) => {
              if (!checked && lockChangelogOff) return
              void saveTab('changelog', checked)
            }}
          />
        )}
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
        <Label htmlFor="launcher-label" className="text-xs text-muted-foreground">
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
        <p className="text-[11px] text-muted-foreground/70">
          Text next to the icon on the launcher button. Leave blank for the icon-only circle.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="launcher-greeting" className="text-xs text-muted-foreground">
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
        <p className="text-[11px] text-muted-foreground/70">
          Shown in a bubble beside the launcher to invite a chat. Leave blank for none.
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
  disabledHint,
  saving,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  /** Why the switch is locked — shown as a tooltip so an inert control never
   *  reads as broken. */
  disabledHint?: string
  saving: boolean
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
      // wrapper tooltip from ever opening — route them to the span instead.
      className={showHint ? 'pointer-events-none' : undefined}
    />
  )
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
        {showHint ? (
          <TooltipProvider delayDuration={200}>
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
        )}
      </div>
    </div>
  )
}

/**
 * One hero color slot: a swatch that opens the shared picker. Empty means
 * "brand color" — shown as a primary-tinted swatch with a dashed ring so it
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
  const cardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  function handleCardDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = cards.findIndex((c) => c.id === active.id)
    const newIndex = cards.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    commitCards(arrayMove(cards, oldIndex, newIndex))
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
          {/* Visual radio tiles: every style is visible at a glance (no
              dropdown to open), and the options panel below reads as attached
              to the selected tile — one bordered group, morphing per choice. */}
          <div
            className="rounded-lg border border-border/50 p-2"
            role="radiogroup"
            aria-label="Home background style"
          >
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
              <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2.5">
                <Label className="text-xs text-muted-foreground">Pattern</Label>
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
              <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2.5">
                <Label className="text-xs text-muted-foreground">Colors</Label>
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
                <p className="text-xs text-muted-foreground">
                  Empty swatches follow your theme&apos;s primary color
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A backdrop for the Home tab. It fills the widget panel, including the header, and fades
            into the background
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
              Show your logo in the Home header (set it under General)
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
                  { id: crypto.randomUUID(), type: 'link', title: '', url: '' },
                ])
              }}
            >
              <PlusIcon className="h-3 w-3 mr-1" />
              Add link card
            </Button>
          </div>

          <DndContext
            sensors={cardSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCardDragEnd}
          >
            <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {cards.map((card, index) => (
                  <SortableHomeCardShell key={card.id} id={card.id}>
                    {(dragHandle) => (
                      <div className="rounded-lg border border-border/50 p-3 space-y-2 bg-card">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {dragHandle}
                            <span className="text-xs font-medium text-foreground truncate">
                              {CARD_TYPE_LABEL[card.type] ?? card.type}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
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
                                onCheckedChange={(checked) =>
                                  updateCard(index, { enabled: checked })
                                }
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
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="everyone">Show to everyone</SelectItem>
                            <SelectItem value="anonymous">Signed-out visitors only</SelectItem>
                            <SelectItem value="identified">Signed-in users only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </SortableHomeCardShell>
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <p className="text-xs text-muted-foreground">
            Drag to reorder. Built-in cards hide automatically when their section is disabled.
            Custom titles override the defaults; leave blank to keep them.
          </p>
        </div>
      </div>
    </SettingsCard>
  )
}

/**
 * Sortable wrapper for one Home card editor block. Render-prop hands the drag
 * handle in so the card keeps its own layout; keyboard reorder works via the
 * handle (dnd-kit KeyboardSensor).
 */
function SortableHomeCardShell({
  id,
  children,
}: {
  id: string
  children: (dragHandle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const dragHandle = (
    <button
      type="button"
      className="cursor-grab touch-none p-0.5 text-muted-foreground/60 hover:text-muted-foreground"
      aria-label="Reorder card"
      {...attributes}
      {...listeners}
    >
      <Bars3Icon className="size-3.5" />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-60')}
    >
      {children(dragHandle)}
    </div>
  )
}

/** Cross-link to the AI & Automation page (assistant identity lives there). */
const TRANSLATABLE_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== 'en')
const TRANSLATION_FIELDS: { key: keyof WidgetContentTranslation; placeholder: string }[] = [
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
              <span className="text-sm font-medium">{WIDGET_LOCALE_LABELS[locale] ?? locale}</span>
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
            <SelectTrigger size="sm">
              <SelectValue placeholder="Add a language" />
            </SelectTrigger>
            <SelectContent>
              {available.map((l) => (
                <SelectItem key={l} value={l}>
                  {WIDGET_LOCALE_LABELS[l] ?? l}
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
        to="/admin/automation/agent"
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
