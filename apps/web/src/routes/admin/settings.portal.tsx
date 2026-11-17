import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { z } from 'zod'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import {
  ClientOnly,
  createFileRoute,
  Link,
  useBlocker,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { Button, NewTabHint } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RichTextEditor, type EditorDocument } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { DraftBar } from '@/components/admin/settings/draft-bar'
import { ThemeModeTiles } from '@/components/admin/settings/branding/theme-mode-tiles'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { PreviewToggleButton } from '@/components/admin/settings/preview-toggle'
import { PortalPreview } from '@/components/admin/settings/branding/portal-preview'
import { AdvancedCssPanel } from '@/components/admin/settings/branding/advanced-css-panel'
import {
  PortalNavEditor,
  isValidNavLinkUrl,
  servedSectionHosts,
} from '@/components/admin/settings/branding/portal-nav-editor'
import {
  seedNavEditorItems,
  type PortalBuiltInNavType,
} from '@/components/public/portal-header-nav'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'
import { loadBrandingFont } from '@/lib/shared/theme'
import {
  useBrandingState,
  FONT_OPTIONS,
  type BrandingState,
} from '@/components/admin/settings/branding/use-branding-state'
import type { ThemeConfig } from '@/lib/shared/theme'
import { primaryPresetIds, themePresets } from '@/lib/shared/theme/presets'
import { useUpdatePortalConfig } from '@/lib/client/mutations/settings'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useStableCallback } from '@/lib/client/hooks/use-stable-callback'
import { UpgradeModal } from '@/components/admin/upgrade'
import {
  describePlanRefusal,
  describePlanUpgrade,
  isPlanRefusal,
  type UpgradeDescription,
} from '@/lib/shared/describe-upgrade'
import { DEFAULT_PORTAL_CONFIG, isProductEnabled } from '@/lib/shared/types/settings'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { effectiveSectionDomains } from '@/lib/shared/section-domains'
import type {
  PortalConfig,
  PortalNavItemConfig,
  PortalWelcomeCard,
} from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'
import { readBatch } from '@/lib/client/queries/read-batch'
import {
  useCloudEnabled,
  usePermissions,
  useSessionContext,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'
import { SETTINGS_PAGES } from '@/lib/shared/settings-pages'
import {
  PORTAL_PAGE_PERMISSIONS,
  PORTAL_SETTINGS_PATH,
  PORTAL_TAB_LABELS,
  PORTAL_TABS,
  portalTabsFor,
  resolvePortalTab,
  type PortalTab,
} from '@/lib/shared/portal-settings-tabs'

/**
 * Two tabs, in the `?tab=` pattern of the other settings pages:
 *  - `design`          the portal's look, tabs and welcome message (settings.branding),
 *                      saved from the save bar
 *  - `custom-domains`  each section's domain (settings.custom_domain), saved from its
 *                      own dialog. Its code and reads load only when it opens.
 */
const searchSchema = z.object({
  tab: z.enum(PORTAL_TABS).optional(),
})

const loadCustomDomainsTab = () => import('@/components/admin/settings/portal-custom-domains-tab')
const PortalCustomDomainsTab = lazy(loadCustomDomainsTab)

/** The Custom domains tab's code and reads, fetched together when it opens. */
async function warmCustomDomainsTab(queryClient: QueryClient, cloud: boolean) {
  const [{ portalCustomDomainsQuery }] = await Promise.all([
    import('@/lib/client/queries/portal-custom-domains'),
    loadCustomDomainsTab(),
  ])
  await queryClient.ensureQueryData(portalCustomDomainsQuery(cloud))
}

/**
 * The same, read ahead when the pointer or focus reaches the tab. A tab switch
 * keeps the page's route match, so the router reads nothing ahead of it; this
 * does, and the tab then opens on data already in hand. A failed read waits
 * for the tab, which shows it.
 */
function readCustomDomainsTabAhead(queryClient: QueryClient, cloud: boolean) {
  void Promise.all([
    import('@/lib/client/queries/portal-custom-domains'),
    loadCustomDomainsTab(),
  ]).then(([{ portalCustomDomainsQuery }]) =>
    queryClient.prefetchQuery(portalCustomDomainsQuery(cloud))
  )
}

export const Route = createFileRoute('/admin/settings/portal')({
  head: adminPageHead('Portal settings'),
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    // Each tab opens to its own permission, which non-admin team roles lack.
    // Gate the page instead of letting managers land on a shell full of 403s.
    assertRouteAnyPermission(context.permissions, PORTAL_PAGE_PERMISSIONS)
    const tabs = portalTabsFor(context.permissions)
    const tab = resolvePortalTab((location.search as { tab?: PortalTab }).tab, tabs)

    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      // The Design drafts live on the page, so they are read on either tab.
      ...(tabs.includes('design')
        ? [
            ensure(settingsQueries.branding()),
            ensure(settingsQueries.logo()),
            ensure(settingsQueries.customCss()),
            ensure(settingsQueries.portalConfig()),
          ]
        : []),
      tab === 'custom-domains'
        ? warmCustomDomainsTab(context.queryClient, !!context.cloudEnabled)
        : null,
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
  },
  component: PortalSettingsRoute,
})

function PortalSettingsRoute() {
  const permissions = usePermissions()
  const search = useSearch({ from: '/admin/settings/portal' })
  const tabs = useMemo(() => portalTabsFor([...permissions]), [permissions])
  const tab = resolvePortalTab(search.tab, tabs)
  if (tabs.includes('design')) return <PortalPage tab={tab} tabs={tabs} />
  // settings.custom_domain alone: the Custom domains tab is the page.
  return (
    <SettingsPage page="/admin/settings/portal">
      <PortalTabBar tab={tab} tabs={tabs} />
      <CustomDomainsPanel />
    </SettingsPage>
  )
}

/**
 * The tab bar, shown when the viewer has both tabs. Each tab is a link to its
 * `?tab=`, drawn by the admin theme like a module's tabs; a tab the viewer
 * lacks the permission for is not there at all. Kept apart from the open tab,
 * so editing a draft on Design does not render it again.
 */
const PortalTabBar = memo(function PortalTabBar({
  tab,
  tabs,
}: {
  tab: PortalTab
  tabs: readonly PortalTab[]
}) {
  const queryClient = useQueryClient()
  const cloud = useCloudEnabled()
  if (tabs.length < 2) return null
  const readAhead = () => readCustomDomainsTabAhead(queryClient, cloud)
  return (
    <nav
      aria-label={SETTINGS_PAGES[PORTAL_SETTINGS_PATH].label}
      data-slot="tabs-list"
      data-variant="line"
      className="scrollbar-none relative flex items-center overflow-x-auto"
    >
      {tabs.map((value) => (
        <Link
          key={value}
          to={PORTAL_SETTINGS_PATH}
          // Design is the default, so its link carries no tab.
          search={value === 'design' ? {} : { tab: value }}
          replace
          data-slot="tabs-trigger"
          data-variant="line"
          data-active={value === tab ? '' : undefined}
          aria-current={value === tab ? 'page' : undefined}
          className="inline-flex shrink-0 items-center text-sm whitespace-nowrap transition-colors"
          {...(value === 'custom-domains' && value !== tab
            ? { onMouseEnter: readAhead, onFocus: readAhead, onTouchStart: readAhead }
            : {})}
        >
          {PORTAL_TAB_LABELS[value]}
        </Link>
      ))}
    </nav>
  )
})

/** The Custom domains tab, its code and reads loaded when it opens. */
function CustomDomainsPanel({ onLeave }: { onLeave?: () => void }) {
  const cloudEnabled = useCloudEnabled()
  return (
    <Suspense fallback={null}>
      <PortalCustomDomainsTab cloud={cloudEnabled} onLeave={onLeave} />
    </Suspense>
  )
}

function PortalPage({ tab, tabs }: { tab: PortalTab; tabs: readonly PortalTab[] }) {
  const router = useRouter()
  const settings = useWorkspaceSettings()
  const session = useSessionContext()
  const [, startTransition] = useTransition()
  // Display-only: the name is edited on Workspace > General.
  const workspaceName = settings?.name || ''

  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())
  const { data: customCss = '' } = useSuspenseQuery(settingsQueries.customCss())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = portalConfigQuery.data as PortalConfig

  const updatePortalConfig = useUpdatePortalConfig({
    showServerMessage: true,
    ownsError: isPlanRefusal,
  })

  // ============================================
  // Draft state. Everything below commits through the contextual save bar;
  // image uploads are the deliberate exception (they apply immediately).
  // ============================================
  const state = useBrandingState({
    initialLogoUrl: logoData?.url ?? null,
    initialThemeConfig: brandingConfig as ThemeConfig,
    initialCustomCss: customCss,
  })

  // Baselines for dirty tracking, captured once from the loaded values,
  // advanced after a successful save or an explicit discard.
  const themeBaseline = useRef({ css: state.cssText, mode: state.themeMode })

  // Keep the currently-selected font's stylesheet loaded in this document so
  // the Select trigger's own font-preview span (and the "Font" summary text)
  // render in the real typeface, not the fallback stack, while it's async.
  useEffect(() => {
    loadBrandingFont(state.currentFontId)
  }, [state.currentFontId])

  const [welcomeBody, setWelcomeBody] = useState<TiptapContent>(
    config.welcomeCard?.body ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.body
  )
  const welcomeBaseline = useRef(JSON.stringify(welcomeBody))

  const [navItems, setNavItems] = useState<PortalNavItemConfig[]>(() =>
    seedNavEditorItems(config.nav)
  )
  const navBaseline = useRef(JSON.stringify(navItems))

  const [saving, setSaving] = useState(false)
  const [upgrade, setUpgrade] = useState<UpgradeDescription | null>(null)

  const themeDirty =
    state.cssText !== themeBaseline.current.css || state.themeMode !== themeBaseline.current.mode
  const welcomeDirty = JSON.stringify(welcomeBody) !== welcomeBaseline.current
  const navDirty = JSON.stringify(navItems) !== navBaseline.current
  const isDirty = themeDirty || welcomeDirty || navDirty

  // Navigating away with unsaved edits prompts; closing the tab warns too.
  // Moving between this page's tabs keeps the drafts, so it does not.
  // A Cloud change on Custom domains can send the browser to the new primary
  // domain after the change is made; the drafts are not asked about then.
  const leaving = useRef(false)
  const markLeaving = useCallback(() => {
    leaving.current = true
  }, [])
  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!isDirty || saving || leaving.current || next.pathname === current.pathname) return false
      return !window.confirm('You have unsaved portal changes. Leave without saving?')
    },
    enableBeforeUnload: () => isDirty && !leaving.current,
  })

  const handleSave = useStableCallback(async () => {
    // Links with a typed-but-invalid URL would silently vanish from the
    // portal nav, so surface it instead of saving.
    const brokenLink = navItems.find(
      (i) => i.type === 'link' && !!i.url && !isValidNavLinkUrl(i.url)
    )
    if (navDirty && brokenLink) {
      toast.error('Fix the link URL before saving (links need a full https:// address).')
      return
    }

    setSaving(true)
    try {
      if (themeDirty) {
        await state.saveTheme()
        themeBaseline.current = { css: state.cssText, mode: state.themeMode }
      }
      if (welcomeDirty || navDirty) {
        // Placeholder link rows (no URL yet) are drafts, not config.
        const items = navItems.filter((i) => i.type !== 'link' || !!i.url)
        await updatePortalConfig.mutateAsync({
          ...(welcomeDirty ? { welcomeCard: { body: welcomeBody } } : {}),
          ...(navDirty ? { nav: { items } } : {}),
        })
        welcomeBaseline.current = JSON.stringify(welcomeBody)
        navBaseline.current = JSON.stringify(navItems)
      }

      startTransition(() => router.invalidate())
    } catch (error) {
      // A plan refusal opens the upgrade dialog; any other failure raises the
      // shared "Couldn't save" toast from the autosave mutations.
      if (isPlanRefusal(error)) {
        setUpgrade(
          describePlanRefusal(
            error,
            describePlanUpgrade('Custom colours', 'business', { plural: true })
          )
        )
      }
    } finally {
      setSaving(false)
    }
  })

  const handleDiscard = useStableCallback(() => {
    state.setCssText(themeBaseline.current.css)
    state.setThemeMode(themeBaseline.current.mode)
    setWelcomeBody(JSON.parse(welcomeBaseline.current) as TiptapContent)
    setNavItems(JSON.parse(navBaseline.current) as PortalNavItemConfig[])
  })

  // ============================================
  // Preview wiring
  // ============================================
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')

  // Built-in tabs that are currently unavailable (product or tab off) keep
  // their rows in the editor but render inert. Mirrors portal-header.
  const gatedTypes = useMemo(() => {
    const flags = settings?.featureFlags
    const statusAudience = settings?.statusConfig?.audience ?? 'public'
    const statusLoggedIn = !!session?.user && session.user.principalType !== 'anonymous'
    const gates: Record<PortalBuiltInNavType, boolean> = {
      feedback: isProductEnabled(flags, 'feedback'),
      roadmap: isProductEnabled(flags, 'feedback'),
      changelog: isProductEnabled(flags, 'changelog'),
      help: isProductEnabled(flags, 'helpCenter'),
      support: isPortalSupportSurfaceEnabled(flags, settings?.portalConfig),
      status:
        isStatusPagePublished(flags, settings?.statusConfig) &&
        (statusAudience === 'public' || statusLoggedIn),
    }
    return new Set(
      (Object.keys(gates) as PortalBuiltInNavType[]).filter((type) => !gates[type])
    ) as ReadonlySet<string>
  }, [settings, session])

  // A tab served at its own domain shows it under the tab; the domain is set on the Custom domains tab.
  const sectionHosts = useMemo(
    () =>
      servedSectionHosts(
        effectiveSectionDomains({
          sectionDomains: settings?.portalConfig?.sectionDomains,
          legacyHelpDomain: settings?.helpCenterConfig?.domain,
        })
      ),
    [settings]
  )

  const resetNavItems = useCallback(() => setNavItems(seedNavEditorItems(null)), [])

  // Structural drafts pushed into the preview iframe (postMessage, no reload).
  const previewDraft = useMemo<PortalPreviewDraft>(
    () => ({
      nav: { items: navItems },
      welcomeCard: { body: welcomeBody } satisfies PortalWelcomeCard,
    }),
    [navItems, welcomeBody]
  )

  // Saved-config remount signal: changes exactly when a save (or upload) lands.
  const refreshKey = useMemo(
    () => JSON.stringify([brandingConfig, customCss, config, logoData]),
    [brandingConfig, customCss, config, logoData]
  )

  const navigation = (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        <SettingsCard
          title="Appearance"
          description="Theme, color palette and typography, also applied to the embedded widget."
        >
          <AppearanceSettings
            themeMode={state.themeMode}
            setThemeMode={state.setThemeMode}
            activePresetId={state.activePresetId}
            setPreset={state.setPreset}
            font={state.font}
            currentFontId={state.currentFontId}
            setFont={state.setFont}
            radius={state.radius}
            setRadius={state.setRadius}
            cssText={state.cssText}
            setCssText={state.setCssText}
          />
        </SettingsCard>

        <SettingsCard
          title="Navigation"
          description="The portal's top tabs. They apply to the help center and status pages too."
        >
          <PortalNavEditor
            items={navItems}
            onChange={setNavItems}
            gatedTypes={gatedTypes}
            onReset={resetNavItems}
            sectionHosts={sectionHosts}
            linkSectionHosts={tabs.includes('custom-domains')}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Renamed tabs show your text in every language; untouched labels stay translated.
          </p>
        </SettingsCard>

        <SettingsCard
          title="Welcome message"
          description="Shown above the post list on your portal home. Leave empty to show nothing."
        >
          <WelcomeBodyEditor value={welcomeBody} onChange={setWelcomeBody} />
        </SettingsCard>
      </div>

      {/* ── Live portal preview ── */}
      <div className="xl:sticky xl:top-6 min-w-0 self-start">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium whitespace-nowrap">Live preview</span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <PreviewControls
              previewMode={state.previewMode}
              previewModeDisabled={state.previewModeDisabled}
              setPreviewMode={state.setPreviewMode}
              viewport={viewport}
              setViewport={setViewport}
            />
            <Button variant="outline" size="sm" asChild className="whitespace-nowrap">
              <a href="/" target="_blank" rel="noopener noreferrer">
                Open portal
                <NewTabHint />
                <ArrowTopRightOnSquareIcon className="size-3.5 ms-1.5" />
              </a>
            </Button>
          </div>
        </div>

        {/* The iframe waits for hydration; ClientOnly re-renders only itself then. */}
        <ClientOnly>
          <PortalPreview
            theme={state.previewMode}
            refreshKey={refreshKey}
            draftCss={state.cssText}
            cssDirty={themeDirty}
            draft={previewDraft}
            draftDirty={welcomeDirty || navDirty}
            viewport={viewport}
            workspaceName={workspaceName}
            faviconUrl={logoData?.url ?? null}
          />
        </ClientOnly>
      </div>
    </div>
  )

  return (
    <SettingsPage page="/admin/settings/portal" width={tab === 'design' ? 'wide' : 'form'}>
      <PortalTabBar tab={tab} tabs={tabs} />
      {tab === 'design' ? navigation : <CustomDomainsPanel onLeave={markLeaving} />}
      {/* Custom domains save from their own dialog; the drafts wait on the Design tab. */}
      {tab === 'design' && (
        <DraftBar dirty={isDirty} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />
      )}
      <UpgradeModal
        open={upgrade !== null}
        onOpenChange={(open) => {
          if (!open) setUpgrade(null)
        }}
        description={upgrade ?? describePlanUpgrade('Custom colours', 'business', { plural: true })}
      />
    </SettingsPage>
  )
}

type AppearanceSettingsProps = Pick<
  BrandingState,
  | 'themeMode'
  | 'setThemeMode'
  | 'activePresetId'
  | 'setPreset'
  | 'font'
  | 'currentFontId'
  | 'setFont'
  | 'radius'
  | 'setRadius'
  | 'cssText'
  | 'setCssText'
>

/**
 * The theme controls, apart from the page so typing in the welcome message or
 * editing the nav does not render them again.
 */
const AppearanceSettings = memo(function AppearanceSettings({
  themeMode,
  setThemeMode,
  activePresetId,
  setPreset,
  font,
  currentFontId,
  setFont,
  radius,
  setRadius,
  cssText,
  setCssText,
}: AppearanceSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium">Theme mode</Label>
        <ThemeModeTiles value={themeMode} onChange={setThemeMode} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium">Preset</Label>
        <div className="grid grid-cols-3 gap-2">
          {primaryPresetIds.map((presetId) => {
            const preset = themePresets[presetId]
            if (!preset) return null
            const isActive = activePresetId === presetId
            return (
              <button
                key={presetId}
                onClick={() => setPreset(presetId)}
                className={cn(
                  'flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-center text-xs font-medium transition-colors min-w-0',
                  isActive
                    ? 'border-primary bg-primary/5 ring-1 ring-primary text-foreground'
                    : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <div
                  className="h-5 w-5 rounded-full border border-border/50"
                  style={{ backgroundColor: preset.color }}
                />
                <span className="w-full truncate">{preset.name}</span>
                <span className="w-full text-xs text-muted-foreground leading-tight">
                  {preset.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium">Font</Label>
        <Select
          value={currentFontId}
          onValueChange={(id) => {
            const selectedFont = FONT_OPTIONS.find((f) => f.id === id)
            if (selectedFont) setFont(selectedFont.value)
          }}
          onOpenChange={(open) => {
            // Every option previews its own name in its own font, all
            // rendered at once. Load every family the first time the
            // menu opens rather than trying to lazily match hover.
            if (open) {
              for (const f of FONT_OPTIONS) loadBrandingFont(f.id)
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              <span style={{ fontFamily: font }}>
                {FONT_OPTIONS.find((f) => f.id === currentFontId)?.name || 'Select font'}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <FontSelectGroup category="Sans Serif" />
            <FontSelectGroup category="Serif" />
            <FontSelectGroup category="Monospace" />
            <FontSelectGroup category="System" />
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium">Corner roundness</Label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-12">Sharp</span>
          <Slider
            value={[radius * 100]}
            onValueChange={([v]) => setRadius(v / 100)}
            min={0}
            max={100}
            step={5}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-12 text-right">Round</span>
          <div className="h-6 w-6 bg-primary shrink-0" style={{ borderRadius: `${radius}rem` }} />
        </div>
      </div>

      <AdvancedCssPanel value={cssText} onChange={setCssText} />
    </div>
  )
})

type PreviewControlsProps = Pick<
  BrandingState,
  'previewMode' | 'previewModeDisabled' | 'setPreviewMode'
> & {
  viewport: 'desktop' | 'mobile'
  setViewport: (viewport: 'desktop' | 'mobile') => void
}

/** The preview's light/dark and desktop/mobile toggles. */
const PreviewControls = memo(function PreviewControls({
  previewMode,
  previewModeDisabled,
  setPreviewMode,
  viewport,
  setViewport,
}: PreviewControlsProps) {
  return (
    <>
      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
        <PreviewToggleButton
          active={previewMode === 'light'}
          disabled={previewModeDisabled === 'light'}
          onClick={() => setPreviewMode('light')}
          label="Light"
        />
        <PreviewToggleButton
          active={previewMode === 'dark'}
          disabled={previewModeDisabled === 'dark'}
          onClick={() => setPreviewMode('dark')}
          label="Dark"
        />
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
        <PreviewToggleButton
          active={viewport === 'desktop'}
          onClick={() => setViewport('desktop')}
          icon={ComputerDesktopIcon}
          label="Desktop"
          iconOnly
        />
        <PreviewToggleButton
          active={viewport === 'mobile'}
          onClick={() => setViewport('mobile')}
          icon={DevicePhoneMobileIcon}
          label="Mobile"
          iconOnly
        />
      </div>
    </>
  )
})

/** Isolated so the rich-text editor's heavy deps don't re-render the page. */
function WelcomeBodyEditor({
  value,
  onChange,
}: {
  value: TiptapContent
  onChange: (v: TiptapContent) => void
}) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })
  // The editor reports its document once it mounts. The same document again
  // is not an edit, and adopting that copy would re-render the whole page.
  // The live preview and the dirty check read the JSON, so each edit takes it.
  const handleChange = useCallback(
    (document: EditorDocument) => {
      const json = document.json()
      if (JSON.stringify(json) === JSON.stringify(value)) return
      onChange(json as TiptapContent)
    },
    [value, onChange]
  )
  return (
    <RichTextEditor
      value={value}
      onDocumentChange={handleChange}
      placeholder="Tell visitors what kind of feedback you'd love to hear…"
      minHeight="160px"
      className="[&_button]:size-6 [&_button_svg]:size-3.5"
      features={{
        headings: true,
        images: true,
        codeBlocks: true,
        taskLists: true,
        blockquotes: true,
        tables: true,
        dividers: true,
        bubbleMenu: true,
        slashMenu: true,
        embeds: true,
        quackbackEmbeds: true,
      }}
      onImageUpload={uploadImage}
    />
  )
}

// ==============================================
// Font Select Group
// ==============================================
type FontCategory = (typeof FONT_OPTIONS)[number]['category']

function FontSelectGroup({ category }: { category: FontCategory }) {
  const fonts = FONT_OPTIONS.filter((f) => f.category === category)
  return (
    <SelectGroup>
      <SelectLabel>{category}</SelectLabel>
      {fonts.map((f) => (
        <SelectItem key={f.id} value={f.id}>
          <span style={{ fontFamily: f.value }}>{f.name}</span>
        </SelectItem>
      ))}
    </SelectGroup>
  )
}
