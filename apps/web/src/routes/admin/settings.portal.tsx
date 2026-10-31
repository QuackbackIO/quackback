import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { ClientOnly, createFileRoute, useBlocker, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
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
} from '@/components/admin/settings/branding/portal-nav-editor'
import { seedNavEditorItems } from '@/components/public/portal-header-nav'
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
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import { useStableCallback } from '@/lib/client/hooks/use-stable-callback'
import { UpgradeModal } from '@/components/admin/upgrade'
import {
  describePlanRefusal,
  describePlanUpgrade,
  isPlanRefusal,
  type UpgradeDescription,
} from '@/lib/shared/describe-upgrade'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import { portalPageGates } from '@/lib/shared/design/paths'
import type {
  PortalConfig,
  PortalNavItemConfig,
  PortalWelcomeCard,
} from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'
import { AppearanceView } from '@/components/admin/settings/appearance/appearance-view'

export const Route = createFileRoute('/admin/settings/portal')({
  head: adminPageHead('Portal settings'),
  loader: async ({ context }) => {
    // Portal config reads/writes require settings.branding, which non-admin
    // team roles lack. Gate the page instead of letting managers land on a
    // shell full of 403s.
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_BRANDING)

    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.branding()),
      ensure(settingsQueries.logo()),
      ensure(settingsQueries.customCss()),
      ensure(settingsQueries.portalConfig()),
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
      // A workspace on the design engine opens on Appearance. Loaded here,
      // not imported above: a loader's imports ship in the entry chunk.
      context.settings?.portalDesign?.engine === 'v2'
        ? import('@/lib/client/queries/portal-design').then(({ portalDesignQueries }) =>
            Promise.all([
              ensure(portalDesignQueries.editor()),
              ensure(portalDesignQueries.aiStatus()),
            ])
          )
        : undefined,
    ])
  },
  component: PortalSettingsPage,
})

/**
 * On the design engine the page is Appearance, which edits the design draft,
 * the menu and welcome message included. Otherwise it is the page it has
 * always been.
 */
function PortalSettingsPage() {
  const settings = useWorkspaceSettings()
  if (settings?.portalDesign?.engine !== 'v2') return <PortalPage />
  return (
    <DesignedPortalPage
      workspaceName={settings.name}
      faviconUrl={settings.faviconData?.url ?? settings.brandingData?.logoUrl ?? null}
      logoUrl={settings.brandingData?.logoUrl ?? null}
    />
  )
}

function DesignedPortalPage({
  workspaceName,
  faviconUrl,
  logoUrl,
}: {
  workspaceName: string
  faviconUrl: string | null
  logoUrl: string | null
}) {
  return (
    <SettingsPage page="/admin/settings/portal" width="wide">
      <AppearanceView workspaceName={workspaceName} faviconUrl={faviconUrl} logoUrl={logoUrl} />
    </SettingsPage>
  )
}

function PortalPage() {
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
  useBlocker({
    shouldBlockFn: () => {
      if (!isDirty || saving) return false
      return !window.confirm('You have unsaved portal changes. Leave without saving?')
    },
    enableBeforeUnload: () => isDirty,
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
    const signedIn = !!session?.user && session.user.principalType !== 'anonymous'
    const gates = portalPageGates(settings, signedIn)
    return new Set(
      (Object.keys(gates) as Array<keyof typeof gates>).filter((type) => !gates[type])
    ) as ReadonlySet<string>
  }, [settings, session])

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

  return (
    <SettingsPage page="/admin/settings/portal" width="wide">
      {/* Controls left, live portal preview right (sticky). */}
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

      <DraftBar dirty={isDirty} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />
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
