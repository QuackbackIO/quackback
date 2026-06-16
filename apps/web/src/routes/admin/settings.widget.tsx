import { createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition, useMemo, useEffect } from 'react'
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import {
  HighlightedCode,
  type SyntaxLang,
} from '@/components/admin/settings/widget/highlighted-code'
import { WidgetTicketingToggle } from '@/components/admin/settings/widget/widget-ticketing-toggle'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WarningBox } from '@/components/shared/warning-box'
import {
  BrandingLayout,
  BrandingControlsPanel,
  BrandingPreviewPanel,
} from '@/components/admin/settings/branding/branding-layout'
import { WidgetPreview } from '@/components/admin/settings/widget/widget-preview'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Label } from '@/components/ui/label'
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
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { useUpdateWidgetConfig, useRegenerateWidgetSecret } from '@/lib/client/mutations/settings'
import {
  upsertWidgetApplicationFn,
  upsertWidgetEnvironmentProfileFn,
} from '@/lib/server/functions/widget-profiles'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/widget')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      queryClient.ensureQueryData(settingsQueries.helpCenterConfig()),
      queryClient.ensureQueryData(settingsQueries.widgetApplications()),
      queryClient.ensureQueryData(inboxQueries.list()),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(helpCenterQueries.categories()),
      queryClient.ensureQueryData(changelogQueries.taxonomy()),
    ])

    return {}
  },
  component: WidgetSettingsPage,
})

function WidgetSettingsPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const widgetSecretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const helpCenterConfigQuery = useSuspenseQuery(settingsQueries.helpCenterConfig())
  const widgetApplicationsQuery = useSuspenseQuery(settingsQueries.widgetApplications())
  const inboxesQuery = useSuspenseQuery(inboxQueries.list())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const helpCategoriesQuery = useSuspenseQuery(helpCenterQueries.categories())
  const changelogTaxonomyQuery = useSuspenseQuery(changelogQueries.taxonomy())
  const { baseUrl, settings } = useRouteContext({ from: '__root__' })

  const flags = settings?.featureFlags as FeatureFlags | undefined
  const config = widgetConfigQuery.data
  const helpCenterConfig = helpCenterConfigQuery.data

  // Lift appearance state so the preview can react to changes
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>(
    (config.position as 'bottom-right' | 'bottom-left') ?? 'bottom-right'
  )
  const helpCenterFlagEnabled = flags?.helpCenter ?? false
  const helpCenterEnabled = helpCenterConfig?.enabled ?? false
  const [previewTabs, setPreviewTabs] = useState({
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
    help: (config.tabs?.help ?? false) && helpCenterFlagEnabled && helpCenterEnabled,
  })
  const [ticketingEnabled, setTicketingEnabled] = useState(config.ticketing?.enabled ?? false)

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Feedback Widget"
        description="Embed a feedback widget directly in your product to collect feedback from users"
      />

      <WidgetToggle initialEnabled={config.enabled} />
      <WidgetTicketingToggle
        initialEnabled={ticketingEnabled}
        onEnabledChange={setTicketingEnabled}
      />

      {/* Appearance + Preview: two-column layout */}
      <BrandingLayout>
        <BrandingControlsPanel>
          <WidgetAppearanceControls
            config={config}
            boards={boardsQuery.data}
            position={position}
            onPositionChange={setPosition}
            onTabsChange={setPreviewTabs}
            helpCenterEnabled={helpCenterEnabled}
            helpCenterFlagEnabled={helpCenterFlagEnabled}
          />
        </BrandingControlsPanel>
        <BrandingPreviewPanel label="Preview">
          <WidgetPreview
            position={position}
            tabs={previewTabs}
            ticketingEnabled={ticketingEnabled}
          />
        </BrandingPreviewPanel>
      </BrandingLayout>

      <WidgetApplicationsSection
        baseUrl={baseUrl ?? ''}
        applications={widgetApplicationsQuery.data}
        boards={boardsQuery.data}
        helpCategories={helpCategoriesQuery.data}
        changelogTaxonomy={changelogTaxonomyQuery.data}
        inboxes={inboxesQuery.data}
      />

      <WidgetInstallation config={config} secret={widgetSecretQuery.data} baseUrl={baseUrl ?? ''} />
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
    <SettingsCard title="Widget" description="Enable or disable the embeddable feedback widget">
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="widget-toggle" className="text-sm font-medium cursor-pointer">
              Enable Feedback Widget
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, you can embed a feedback widget on any website using a script tag
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={saving || isPending} />
            <Switch
              id="widget-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={saving || isPending}
              aria-label="Feedback Widget"
            />
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

function WidgetAppearanceControls({
  config,
  boards,
  position,
  onPositionChange,
  onTabsChange,
  helpCenterEnabled,
  helpCenterFlagEnabled,
}: {
  config: {
    defaultBoard?: string
    position?: string
    tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean; home?: boolean }
  }
  boards: { id: string; name: string; slug: string }[]
  position: 'bottom-right' | 'bottom-left'
  onPositionChange: (val: 'bottom-right' | 'bottom-left') => void
  onTabsChange: (tabs: { feedback: boolean; changelog: boolean; help: boolean }) => void
  helpCenterEnabled: boolean
  helpCenterFlagEnabled: boolean
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [defaultBoard, setDefaultBoard] = useState(config.defaultBoard ?? '')
  const [widgetTabs, setWidgetTabs] = useState({
    feedback: config.tabs?.feedback ?? true,
    changelog: config.tabs?.changelog ?? false,
  })
  const [helpTab, setHelpTab] = useState(config.tabs?.help ?? false)
  const [homeTab, setHomeTab] = useState(config.tabs?.home ?? true)

  const showHelpTabToggle = helpCenterFlagEnabled && helpCenterEnabled

  async function save(updates: Parameters<typeof updateWidgetConfig.mutateAsync>[0]) {
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync(updates)
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  const isBusy = saving || isPending

  return (
    <>
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Appearance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize the widget launcher button and default behavior
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="widget-position" className="text-xs text-muted-foreground">
            Button Position
          </Label>
          <Select
            value={position}
            onValueChange={(val: 'bottom-right' | 'bottom-left') => {
              onPositionChange(val)
              save({ position: val })
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
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Tabs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which sections to show in the widget. The tab bar is hidden when only one is
            enabled.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label htmlFor="tab-home" className="text-xs font-medium cursor-pointer">
                Home
              </Label>
              <p className="text-xs text-muted-foreground">
                Overview tab that greets users and links to your sections. Only appears when two or
                more sections are enabled.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <InlineSpinner visible={saving} />
              <Switch
                id="tab-home"
                checked={homeTab}
                onCheckedChange={async (checked) => {
                  setHomeTab(checked)
                  setSaving(true)
                  try {
                    await updateWidgetConfig.mutateAsync({ tabs: { home: checked } })
                    startTransition(() => router.invalidate())
                  } catch {
                    setHomeTab(!checked)
                  } finally {
                    setSaving(false)
                  }
                }}
                disabled={isBusy}
                aria-label="Home tab"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label htmlFor="tab-feedback" className="text-xs font-medium cursor-pointer">
                Feedback
              </Label>
              <p className="text-xs text-muted-foreground">Search, vote, and submit ideas</p>
            </div>
            <Switch
              id="tab-feedback"
              checked={widgetTabs.feedback}
              onCheckedChange={(checked) => {
                if (!checked && !widgetTabs.changelog) return
                const next = { ...widgetTabs, feedback: checked }
                setWidgetTabs(next)
                onTabsChange({ ...next, help: helpTab })
                save({ tabs: next })
              }}
              disabled={isBusy || (widgetTabs.feedback && !widgetTabs.changelog)}
              aria-label="Feedback tab"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label htmlFor="tab-changelog" className="text-xs font-medium cursor-pointer">
                Changelog
              </Label>
              <p className="text-xs text-muted-foreground">
                Show product updates and shipped features
              </p>
            </div>
            <Switch
              id="tab-changelog"
              checked={widgetTabs.changelog}
              onCheckedChange={(checked) => {
                if (!checked && !widgetTabs.feedback) return
                const next = { ...widgetTabs, changelog: checked }
                setWidgetTabs(next)
                onTabsChange({ ...next, help: helpTab })
                save({ tabs: next })
              }}
              disabled={isBusy || (widgetTabs.changelog && !widgetTabs.feedback)}
              aria-label="Changelog tab"
            />
          </div>

          {showHelpTabToggle && (
            <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
              <div>
                <Label htmlFor="tab-help" className="text-xs font-medium cursor-pointer">
                  Help
                </Label>
                <p className="text-xs text-muted-foreground">Show help center articles</p>
              </div>
              <div className="flex items-center gap-2">
                <InlineSpinner visible={saving} />
                <Switch
                  id="tab-help"
                  checked={helpTab}
                  onCheckedChange={async (checked) => {
                    setHelpTab(checked)
                    onTabsChange({ ...widgetTabs, help: checked })
                    setSaving(true)
                    try {
                      await updateWidgetConfig.mutateAsync({ tabs: { help: checked } })
                      startTransition(() => router.invalidate())
                    } catch {
                      setHelpTab(!checked)
                      onTabsChange({ ...widgetTabs, help: !checked })
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={isBusy}
                  aria-label="Help tab"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Default Board</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which board is selected by default when creating new posts from the widget
          </p>
        </div>

        <Select
          value={defaultBoard || ''}
          onValueChange={(val) => {
            setDefaultBoard(val)
            save({ defaultBoard: val })
          }}
          disabled={isBusy}
        >
          <SelectTrigger
            className="w-full"
            onClear={
              defaultBoard
                ? () => {
                    setDefaultBoard('')
                    save({ defaultBoard: '' })
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
      </div>
    </>
  )
}

type WidgetProfilePriority = 'low' | 'normal' | 'high' | 'urgent'

type WidgetSupportCategoryRow = {
  categoryKey: string
  label: string
  description?: string
  icon?: string
  inboxId: string
  defaultPriority?: WidgetProfilePriority
  allowedPriorities?: WidgetProfilePriority[]
  visible?: boolean
  display?: {
    showPrioritySelector?: boolean
  }
}

type WidgetProfileRow = {
  id: string
  environment: string
  displayName: string
  enabled: boolean
  allowedOrigins: string[]
  configOverrides?: {
    tabs?: {
      home?: boolean
      feedback?: boolean
      changelog?: boolean
      help?: boolean
      chat?: boolean
    }
  }
  contentFilters?: {
    feedback?: { boardIds?: string[] }
    changelog?: {
      mode?: 'all_published' | 'linked_to_allowed_feedback' | 'selected_entries'
      categoryIds?: string[]
      productIds?: string[]
    }
    help?: { categoryIds?: string[] }
  }
  supportConfig?: {
    categories?: WidgetSupportCategoryRow[]
  }
}

type WidgetApplicationRow = {
  id: string
  key: string
  name: string
  description: string | null
  profiles: WidgetProfileRow[]
}

type SupportCategoryDraft = {
  categoryKey: string
  label: string
  description: string
  icon: string
  inboxId: string
  defaultPriority: WidgetProfilePriority
  visible: boolean
  showPrioritySelector: boolean
}

type HelpCenterCategoryRow = {
  id: string
  parentId: string | null
  name: string
  isPublic: boolean
  recursivePublishedArticleCount?: number
}

type HelpCenterCategoryOption = HelpCenterCategoryRow & {
  depth: number
}

const fieldCls =
  'w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15'

function emptySupportCategoryDraft(): SupportCategoryDraft {
  return {
    categoryKey: '',
    label: '',
    description: '',
    icon: '',
    inboxId: '',
    defaultPriority: 'normal',
    visible: true,
    showPrioritySelector: true,
  }
}

function supportCategoryDrafts(categories?: WidgetSupportCategoryRow[]): SupportCategoryDraft[] {
  const drafts =
    categories?.map((category) => ({
      categoryKey: category.categoryKey ?? '',
      label: category.label ?? '',
      description: category.description ?? '',
      icon: category.icon ?? '',
      inboxId: category.inboxId ?? '',
      defaultPriority: category.defaultPriority ?? 'normal',
      visible: category.visible ?? true,
      showPrioritySelector: category.display?.showPrioritySelector ?? true,
    })) ?? []

  return drafts.length > 0 ? drafts : [emptySupportCategoryDraft()]
}

function buildHelpCategoryOptions(categories: HelpCenterCategoryRow[]): HelpCenterCategoryOption[] {
  const childrenByParent = new Map<string | null, HelpCenterCategoryRow[]>()
  for (const category of categories) {
    const key = category.parentId ?? null
    const existing = childrenByParent.get(key)
    if (existing) existing.push(category)
    else childrenByParent.set(key, [category])
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name))
  }

  const options: HelpCenterCategoryOption[] = []
  const visited = new Set<string>()

  function visit(category: HelpCenterCategoryRow, depth: number) {
    if (visited.has(category.id)) return
    visited.add(category.id)
    options.push({ ...category, depth })
    for (const child of childrenByParent.get(category.id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const category of childrenByParent.get(null) ?? []) {
    visit(category, 0)
  }
  for (const category of categories) {
    visit(category, 0)
  }

  return options
}

function WidgetApplicationsSection({
  baseUrl,
  applications,
  boards,
  helpCategories,
  changelogTaxonomy,
  inboxes,
}: {
  baseUrl: string
  applications: WidgetApplicationRow[]
  boards: { id: string; name: string; slug: string }[]
  helpCategories: HelpCenterCategoryRow[]
  changelogTaxonomy: {
    categories: { id: string; name: string }[]
    products: { id: string; name: string }[]
  }
  inboxes: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [selectedAppId, setSelectedAppId] = useState(applications[0]?.id ?? '')
  const selectedApp = applications.find((app) => app.id === selectedAppId) ?? applications[0]
  const [appKey, setAppKey] = useState('')
  const [appName, setAppName] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    selectedApp?.profiles[0]?.id ?? null
  )
  const selectedProfile =
    selectedApp?.profiles.find((profile) => profile.id === selectedProfileId) ??
    selectedApp?.profiles[0] ??
    null
  const [environment, setEnvironment] = useState(selectedProfile?.environment ?? 'production')
  const [enabled, setEnabled] = useState(selectedProfile?.enabled ?? true)
  const [origins, setOrigins] = useState((selectedProfile?.allowedOrigins ?? []).join('\n'))
  const [tabs, setTabs] = useState({
    home: selectedProfile?.configOverrides?.tabs?.home ?? true,
    feedback: selectedProfile?.configOverrides?.tabs?.feedback ?? true,
    changelog: selectedProfile?.configOverrides?.tabs?.changelog ?? false,
    help: selectedProfile?.configOverrides?.tabs?.help ?? false,
    chat: selectedProfile?.configOverrides?.tabs?.chat ?? false,
  })
  const [allowedBoardIds, setAllowedBoardIds] = useState<string[]>(
    selectedProfile?.contentFilters?.feedback?.boardIds ?? []
  )
  const [allowedHelpCategoryIds, setAllowedHelpCategoryIds] = useState<string[]>(
    selectedProfile?.contentFilters?.help?.categoryIds ?? []
  )
  const [allowedChangelogCategoryIds, setAllowedChangelogCategoryIds] = useState<string[]>(
    selectedProfile?.contentFilters?.changelog?.categoryIds ?? []
  )
  const [allowedChangelogProductIds, setAllowedChangelogProductIds] = useState<string[]>(
    selectedProfile?.contentFilters?.changelog?.productIds ?? []
  )
  const [changelogMode, setChangelogMode] = useState<
    'all_published' | 'linked_to_allowed_feedback' | 'selected_entries'
  >(selectedProfile?.contentFilters?.changelog?.mode ?? 'all_published')
  const [supportCategories, setSupportCategories] = useState<SupportCategoryDraft[]>(() =>
    supportCategoryDrafts(selectedProfile?.supportConfig?.categories)
  )

  useEffect(() => {
    if (selectedApp && !applications.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(selectedApp.id)
    }
  }, [applications, selectedApp, selectedAppId])

  useEffect(() => {
    const profile =
      selectedApp?.profiles.find((p) => p.id === selectedProfileId) ??
      selectedApp?.profiles[0] ??
      null
    setSelectedProfileId(profile?.id ?? null)
    setEnvironment(profile?.environment ?? 'production')
    setEnabled(profile?.enabled ?? true)
    setOrigins((profile?.allowedOrigins ?? []).join('\n'))
    setTabs({
      home: profile?.configOverrides?.tabs?.home ?? true,
      feedback: profile?.configOverrides?.tabs?.feedback ?? true,
      changelog: profile?.configOverrides?.tabs?.changelog ?? false,
      help: profile?.configOverrides?.tabs?.help ?? false,
      chat: profile?.configOverrides?.tabs?.chat ?? false,
    })
    setAllowedBoardIds(profile?.contentFilters?.feedback?.boardIds ?? [])
    setAllowedHelpCategoryIds(profile?.contentFilters?.help?.categoryIds ?? [])
    setAllowedChangelogCategoryIds(profile?.contentFilters?.changelog?.categoryIds ?? [])
    setAllowedChangelogProductIds(profile?.contentFilters?.changelog?.productIds ?? [])
    setChangelogMode(profile?.contentFilters?.changelog?.mode ?? 'all_published')
    setSupportCategories(supportCategoryDrafts(profile?.supportConfig?.categories))
  }, [selectedApp?.id, selectedProfileId])

  async function saveApplication() {
    if (!appKey.trim() || !appName.trim()) return
    setSaving(true)
    try {
      const app = await upsertWidgetApplicationFn({
        data: { key: appKey, name: appName },
      })
      if (!app) return
      setSelectedAppId(app.id)
      setAppKey('')
      setAppName('')
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  async function saveProfile() {
    if (!selectedApp || !environment.trim()) return
    setSaving(true)
    try {
      const categories = supportCategories
        .map((category) => ({
          categoryKey: category.categoryKey.trim(),
          label: category.label.trim(),
          description: category.description.trim() || undefined,
          icon: category.icon.trim() || undefined,
          inboxId: category.inboxId,
          defaultPriority: category.defaultPriority,
          allowedPriorities: ['low', 'normal', 'high', 'urgent'] as WidgetProfilePriority[],
          visible: category.visible,
          display: {
            showPrioritySelector: category.showPrioritySelector,
          },
        }))
        .filter((category) => category.categoryKey && category.label && category.inboxId)
      const profile = await upsertWidgetEnvironmentProfileFn({
        data: {
          id: selectedProfileId ?? undefined,
          applicationId: selectedApp.id,
          environment,
          displayName: environment,
          enabled,
          allowedOrigins: origins
            .split(/\n|,/)
            .map((origin) => origin.trim())
            .filter(Boolean),
          configOverrides: { tabs },
          contentFilters: {
            feedback: allowedBoardIds.length > 0 ? { boardIds: allowedBoardIds } : {},
            changelog: {
              mode: changelogMode,
              categoryIds:
                allowedChangelogCategoryIds.length > 0 ? allowedChangelogCategoryIds : undefined,
              productIds:
                allowedChangelogProductIds.length > 0 ? allowedChangelogProductIds : undefined,
            },
            help:
              allowedHelpCategoryIds.length > 0
                ? { categoryIds: allowedHelpCategoryIds }
                : undefined,
          },
          supportConfig: {
            ticketListScope: 'same_profile_allowed_inboxes',
            categories,
          },
        },
      })
      if (!profile) return
      setSelectedProfileId(profile.id)
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  function updateSupportCategory(index: number, patch: Partial<SupportCategoryDraft>) {
    setSupportCategories((prev) =>
      prev.map((category, categoryIndex) =>
        categoryIndex === index ? { ...category, ...patch } : category
      )
    )
  }

  function addSupportCategory() {
    setSupportCategories((prev) => [...prev, emptySupportCategoryDraft()])
  }

  function removeSupportCategory(index: number) {
    setSupportCategories((prev) => {
      const next = prev.filter((_, categoryIndex) => categoryIndex !== index)
      return next.length > 0 ? next : [emptySupportCategoryDraft()]
    })
  }

  const installSnippet = selectedApp
    ? `<script>
  (function(w,d){if(w.Quackback)return;w.Quackback=function(){
  (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.crossOrigin="anonymous";
  s.dataset.applicationKey=${JSON.stringify(selectedApp.key)};
  s.dataset.environment=${JSON.stringify(environment)};
  s.src=${JSON.stringify(`${baseUrl}/api/widget/sdk.js`)};
  d.head.appendChild(s)})(window,document);

  Quackback("init", {
    instanceUrl: ${JSON.stringify(baseUrl)},
    applicationKey: ${JSON.stringify(selectedApp.key)},
    environment: ${JSON.stringify(environment)}
  });
</script>`
    : ''
  const isBusy = saving || isPending
  const helpCategoryOptions = useMemo(
    () => buildHelpCategoryOptions(helpCategories),
    [helpCategories]
  )

  return (
    <SettingsCard
      title="Applications & environments"
      description="Scope embedded widget features, content, origins, and support routing per external app."
      contentClassName="overflow-x-auto"
    >
      <div className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            placeholder="customer-dashboard"
            className={fieldCls}
            disabled={isBusy}
          />
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="Customer dashboard"
            className={fieldCls}
            disabled={isBusy}
          />
          <Button type="button" onClick={saveApplication} disabled={isBusy}>
            Add app
          </Button>
        </div>

        {applications.length > 0 && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
              {applications.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedAppId(app.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    selectedApp?.id === app.id
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border/60 hover:bg-muted/40'
                  )}
                >
                  <span className="block font-medium">{app.name}</span>
                  <span className="block text-xs text-muted-foreground">{app.key}</span>
                </button>
              ))}
            </div>

            <div className="min-w-0 space-y-4 rounded-lg border border-border/60 p-4">
              {selectedApp && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {selectedApp.profiles.map((profile) => (
                      <Button
                        key={profile.id}
                        type="button"
                        variant={selectedProfileId === profile.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedProfileId(profile.id)}
                      >
                        {profile.environment}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedProfileId(null)
                        setEnvironment('production')
                      }}
                    >
                      New environment
                    </Button>
                  </div>

                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Environment</Label>
                      <input
                        value={environment}
                        onChange={(e) => setEnvironment(e.target.value)}
                        className={fieldCls}
                        disabled={isBusy}
                      />
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                      <div>
                        <Label className="text-xs font-medium">Enabled</Label>
                        <p className="text-xs text-muted-foreground">Disable to hide this embed.</p>
                      </div>
                      <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isBusy} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Allowed origins</Label>
                    <textarea
                      value={origins}
                      onChange={(e) => setOrigins(e.target.value)}
                      placeholder={`https://app.example.com\nhttp://localhost:*`}
                      className={`${fieldCls} min-h-20`}
                      disabled={isBusy}
                    />
                  </div>

                  <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <Label className="text-xs text-muted-foreground">Features</Label>
                      {(['home', 'feedback', 'changelog', 'help', 'chat'] as const).map((tab) => (
                        <div
                          key={tab}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="text-sm capitalize">{tab}</span>
                          <Switch
                            checked={tabs[tab]}
                            onCheckedChange={(checked) =>
                              setTabs((prev) => ({ ...prev, [tab]: checked }))
                            }
                            disabled={isBusy}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="min-w-0 space-y-3">
                      <Label className="text-xs text-muted-foreground">Allowed boards</Label>
                      <div className="max-h-44 overflow-auto rounded-md border border-border/60 p-2">
                        {boards.map((board) => (
                          <label
                            key={board.id}
                            className="flex items-center gap-2 px-1 py-1 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={allowedBoardIds.includes(board.id)}
                              onChange={(e) =>
                                setAllowedBoardIds((prev) =>
                                  e.target.checked
                                    ? [...prev, board.id]
                                    : prev.filter((id) => id !== board.id)
                                )
                              }
                              disabled={isBusy}
                            />
                            {board.name}
                          </label>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <Label className="text-xs text-muted-foreground">
                          Help center categories
                        </Label>
                        {allowedHelpCategoryIds.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            All categories included
                          </span>
                        )}
                      </div>
                      <div className="max-h-44 overflow-auto rounded-md border border-border/60 p-2">
                        {helpCategoryOptions.length === 0 ? (
                          <p className="px-1 py-1 text-sm text-muted-foreground">
                            No help center categories yet.
                          </p>
                        ) : (
                          helpCategoryOptions.map((category) => (
                            <label
                              key={category.id}
                              className="flex items-center gap-2 px-1 py-1 text-sm"
                              style={{ paddingLeft: 4 + category.depth * 16 }}
                            >
                              <input
                                type="checkbox"
                                checked={allowedHelpCategoryIds.includes(category.id)}
                                onChange={(e) =>
                                  setAllowedHelpCategoryIds((prev) =>
                                    e.target.checked
                                      ? [...prev, category.id]
                                      : prev.filter((id) => id !== category.id)
                                  )
                                }
                                disabled={isBusy}
                              />
                              <span className="min-w-0 flex-1 truncate">{category.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {category.isPublic ? 'Public' : 'Private'}
                              </span>
                            </label>
                          ))
                        )}
                      </div>

                      <Label className="text-xs text-muted-foreground">Changelog</Label>
                      <Select
                        value={changelogMode}
                        onValueChange={(value) => setChangelogMode(value as typeof changelogMode)}
                        disabled={isBusy}
                      >
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all_published">All published entries</SelectItem>
                          <SelectItem value="linked_to_allowed_feedback">
                            Linked to allowed feedback
                          </SelectItem>
                          <SelectItem value="selected_entries">Selected entries</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <Label className="text-xs text-muted-foreground">
                          Changelog categories
                        </Label>
                        {allowedChangelogCategoryIds.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            All categories included
                          </span>
                        )}
                      </div>
                      <div className="max-h-44 overflow-auto rounded-md border border-border/60 p-2">
                        {changelogTaxonomy.categories.length === 0 ? (
                          <p className="px-1 py-1 text-sm text-muted-foreground">
                            No changelog categories yet.
                          </p>
                        ) : (
                          changelogTaxonomy.categories.map((category) => (
                            <label
                              key={category.id}
                              className="flex items-center gap-2 px-1 py-1 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={allowedChangelogCategoryIds.includes(category.id)}
                                onChange={(e) =>
                                  setAllowedChangelogCategoryIds((prev) =>
                                    e.target.checked
                                      ? [...prev, category.id]
                                      : prev.filter((id) => id !== category.id)
                                  )
                                }
                                disabled={isBusy}
                              />
                              <span className="min-w-0 flex-1 truncate">{category.name}</span>
                            </label>
                          ))
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <Label className="text-xs text-muted-foreground">Changelog products</Label>
                        {allowedChangelogProductIds.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            All products included
                          </span>
                        )}
                      </div>
                      <div className="max-h-44 overflow-auto rounded-md border border-border/60 p-2">
                        {changelogTaxonomy.products.length === 0 ? (
                          <p className="px-1 py-1 text-sm text-muted-foreground">
                            No changelog products yet.
                          </p>
                        ) : (
                          changelogTaxonomy.products.map((product) => (
                            <label
                              key={product.id}
                              className="flex items-center gap-2 px-1 py-1 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={allowedChangelogProductIds.includes(product.id)}
                                onChange={(e) =>
                                  setAllowedChangelogProductIds((prev) =>
                                    e.target.checked
                                      ? [...prev, product.id]
                                      : prev.filter((id) => id !== product.id)
                                  )
                                }
                                disabled={isBusy}
                              />
                              <span className="min-w-0 flex-1 truncate">{product.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs text-muted-foreground">Support categories</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addSupportCategory}
                        disabled={isBusy}
                      >
                        <PlusIcon className="mr-1.5 h-4 w-4" />
                        Add category
                      </Button>
                    </div>

                    {supportCategories.map((category, index) => (
                      <div
                        key={index}
                        className="min-w-0 space-y-3 rounded-md border border-border/60 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">Category {index + 1}</p>
                            <p className="text-xs text-muted-foreground">
                              Route this widget support option into an inbox.
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Switch
                                checked={category.visible}
                                onCheckedChange={(visible) =>
                                  updateSupportCategory(index, { visible })
                                }
                                disabled={isBusy}
                              />
                              Visible
                            </Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeSupportCategory(index)}
                              disabled={isBusy}
                              aria-label="Remove support category"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Support key</Label>
                            <input
                              value={category.categoryKey}
                              onChange={(e) =>
                                updateSupportCategory(index, { categoryKey: e.target.value })
                              }
                              placeholder="billing"
                              className={fieldCls}
                              disabled={isBusy}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Label</Label>
                            <input
                              value={category.label}
                              onChange={(e) =>
                                updateSupportCategory(index, { label: e.target.value })
                              }
                              placeholder="Billing"
                              className={fieldCls}
                              disabled={isBusy}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Inbox</Label>
                            <Select
                              value={category.inboxId}
                              onValueChange={(inboxId) => updateSupportCategory(index, { inboxId })}
                              disabled={isBusy}
                            >
                              <SelectTrigger className="w-full min-w-0">
                                <SelectValue placeholder="Select inbox" />
                              </SelectTrigger>
                              <SelectContent>
                                {inboxes.map((inbox) => (
                                  <SelectItem key={inbox.id} value={inbox.id}>
                                    {inbox.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">
                              Default priority
                            </Label>
                            <Select
                              value={category.defaultPriority}
                              onValueChange={(defaultPriority) =>
                                updateSupportCategory(index, {
                                  defaultPriority: defaultPriority as WidgetProfilePriority,
                                })
                              }
                              disabled={isBusy}
                            >
                              <SelectTrigger className="w-full min-w-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="normal">Normal</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="urgent">Urgent</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Description</Label>
                            <input
                              value={category.description}
                              onChange={(e) =>
                                updateSupportCategory(index, { description: e.target.value })
                              }
                              placeholder="Questions about invoices and plans"
                              className={fieldCls}
                              disabled={isBusy}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Icon</Label>
                            <input
                              value={category.icon}
                              onChange={(e) =>
                                updateSupportCategory(index, { icon: e.target.value })
                              }
                              placeholder="credit-card"
                              className={fieldCls}
                              disabled={isBusy}
                            />
                          </div>
                        </div>

                        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                          <div className="min-w-0">
                            <Label className="text-xs font-medium">Priority selector</Label>
                            <p className="text-xs text-muted-foreground">
                              Allow requesters to choose priority for this category.
                            </p>
                          </div>
                          <Switch
                            checked={category.showPrioritySelector}
                            onCheckedChange={(showPrioritySelector) =>
                              updateSupportCategory(index, { showPrioritySelector })
                            }
                            disabled={isBusy}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {installSnippet && (
                    <pre className="max-w-full overflow-x-auto rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      {installSnippet}
                    </pre>
                  )}

                  <div className="flex justify-end">
                    <Button type="button" onClick={saveProfile} disabled={isBusy || !selectedApp}>
                      Save environment
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
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

const CLIENT_CODE_SIMPLE = `import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

// The widget loads anonymously after Quackback("init"). Call identify
// once you know who the user is — no need to call it for anonymous.
export function WidgetIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    Quackback("identify", {
      id: user.id,
      email: user.email,
      name: user.name,
    });
  }, [user]);

  return null;
}`

const CLIENT_CODE_WITH_TOKEN = `import { useEffect } from "react";
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

function WidgetInstallation({
  config,
  secret,
  baseUrl,
}: {
  config: { identifyVerification?: boolean }
  secret: string | null
  baseUrl: string
}) {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const regenerateSecret = useRegenerateWidgetSecret()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  // Guide UI state
  const [framework, setFramework] = useState('nextjs')
  const [activeTab, setActiveTab] = useState('snippet')

  // Persisted state
  const [verifiedIdentityOnly, setVerifiedIdentityOnly] = useState(
    config.identifyVerification ?? false
  )
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

  // Build dynamic tabs based on options
  const tabs = useMemo<CodeTab[]>(() => {
    const t: CodeTab[] = [
      { id: 'snippet', label: 'snippet.html', lang: 'js', code: installSnippet },
    ]
    if (verifiedIdentityOnly) {
      const ex = SERVER_EXAMPLES.find((e) => e.id === framework)
      if (ex) {
        t.push({ id: 'server', label: ex.filename, lang: ex.lang, code: ex.code })
      }
    }
    t.push({
      id: 'client',
      label: 'identify.tsx',
      lang: 'js',
      code: verifiedIdentityOnly ? CLIENT_CODE_WITH_TOKEN : CLIENT_CODE_SIMPLE,
    })
    return t
  }, [installSnippet, verifiedIdentityOnly, framework])

  // Reset active tab if it's no longer available
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab('snippet')
    }
  }, [tabs, activeTab])

  const activeTabData = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  async function handleVerifiedIdentityToggle(checked: boolean) {
    setVerifiedIdentityOnly(checked)
    setSaving(true)
    try {
      await updateWidgetConfig.mutateAsync({ identifyVerification: checked })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

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
    ? currentSecret.slice(0, 8) + '\u2022'.repeat(Math.max(0, currentSecret.length - 8))
    : null

  const isBusy = saving || isPending

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
              {/* Verified identity toggle */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-foreground">
                    Verified identity only
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Disable inline email capture and require your app to sign each user
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InlineSpinner visible={isBusy} />
                  <Switch
                    checked={verifiedIdentityOnly}
                    onCheckedChange={handleVerifiedIdentityToggle}
                    disabled={isBusy}
                    aria-label="Require verified widget identity"
                  />
                </div>
              </div>

              {!verifiedIdentityOnly && (
                <p className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded px-2 py-1.5 leading-relaxed">
                  Without verification, anyone with a customer&apos;s email can post as them. Team
                  accounts are always protected.
                </p>
              )}

              {verifiedIdentityOnly && (
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
              )}
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
