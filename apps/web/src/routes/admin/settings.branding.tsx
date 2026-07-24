import { lazy, Suspense, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, useBlocker, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  SunIcon,
  MoonIcon,
  ArrowPathIcon,
  CameraIcon,
  PaintBrushIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ImageCropper } from '@/components/ui/image-cropper'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { PreviewToggleButton } from '@/components/admin/settings/preview-toggle'
import { PortalPreview } from '@/components/admin/settings/branding/portal-preview'
import {
  PortalNavEditor,
  isValidNavLinkUrl,
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
} from '@/components/admin/settings/branding/use-branding-state'
import {
  primaryPresetIds,
  themePresets,
  type ThemeConfig,
  type ThemeMode,
} from '@/lib/shared/theme'
import { useSettingsLogo } from '@/lib/client/hooks/use-settings-queries'
import {
  useUploadWorkspaceLogo,
  useDeleteWorkspaceLogo,
  useUpdatePortalConfig,
} from '@/lib/client/mutations/settings'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  DEFAULT_PORTAL_CONFIG,
  PORTAL_WELCOME_CARD_TITLE_MAX,
  isProductEnabled,
} from '@/lib/shared/types/settings'
import type {
  PortalConfig,
  PortalNavItemConfig,
  PortalWelcomeCard,
} from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'

// @uiw/react-codemirror + @codemirror/lang-css make this the largest route
// chunk in the app, yet most visits never open the "Advanced CSS" panel —
// defer it to its own chunk, loaded only when the <details> is expanded.
const CustomCssEditor = lazy(() =>
  import('@/components/admin/settings/branding/custom-css-editor').then((m) => ({
    default: m.CustomCssEditor,
  }))
)

// Fixed-height skeleton matching the editor's rendered height (280px) plus
// its border, so the Advanced CSS panel doesn't jump while the chunk loads.
function CustomCssEditorFallback() {
  return (
    <div
      className="h-[280px] animate-pulse rounded-md border border-input bg-muted/30"
      aria-hidden="true"
    />
  )
}

export const Route = createFileRoute('/admin/settings/branding')({
  loader: async ({ context }) => {
    // Portal config reads/writes require settings.branding, which non-admin
    // team roles lack — gate the page like the old Portal page did instead
    // of letting managers land on a shell full of 403s.
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_BRANDING)

    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.branding()),
      context.queryClient.ensureQueryData(settingsQueries.logo()),
      context.queryClient.ensureQueryData(settingsQueries.customCss()),
      context.queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
  },
  component: BrandingPage,
})

function BrandingPage() {
  const router = useRouter()
  const { settings } = Route.useRouteContext()
  const [, startTransition] = useTransition()
  // Display-only: the name is edited on Workspace > General.
  const workspaceName = settings?.name || ''

  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())
  const { data: customCss = '' } = useSuspenseQuery(settingsQueries.customCss())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = portalConfigQuery.data as PortalConfig

  const updatePortalConfig = useUpdatePortalConfig()

  // ============================================
  // Draft state. Everything below commits through the contextual save bar;
  // image uploads are the deliberate exception (they apply immediately).
  // ============================================
  const state = useBrandingState({
    initialLogoUrl: logoData?.url ?? null,
    initialThemeConfig: brandingConfig as ThemeConfig,
    initialCustomCss: customCss,
  })

  // Baselines for dirty tracking — captured once from the loaded values,
  // advanced after a successful save or an explicit discard.
  const themeBaseline = useRef({ css: state.cssText, mode: state.themeMode })

  // Keep the currently-selected font's stylesheet loaded in this document so
  // the Select trigger's own font-preview span (and the "Font" summary text)
  // render in the real typeface, not the fallback stack, while it's async.
  useEffect(() => {
    loadBrandingFont(state.currentFontId)
  }, [state.currentFontId])

  const [welcomeEnabled, setWelcomeEnabled] = useState(config.welcomeCard?.enabled ?? false)
  const [welcomeTitle, setWelcomeTitle] = useState(
    config.welcomeCard?.title ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.title
  )
  const [welcomeBody, setWelcomeBody] = useState<TiptapContent>(
    config.welcomeCard?.body ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.body
  )
  const welcomeBaseline = useRef(
    JSON.stringify({ enabled: welcomeEnabled, title: welcomeTitle, body: welcomeBody })
  )

  const [navItems, setNavItems] = useState<PortalNavItemConfig[]>(() =>
    seedNavEditorItems(config.nav)
  )
  const navBaseline = useRef(JSON.stringify(navItems))

  const [saving, setSaving] = useState(false)

  const themeDirty =
    state.cssText !== themeBaseline.current.css || state.themeMode !== themeBaseline.current.mode
  const welcomeDirty =
    JSON.stringify({ enabled: welcomeEnabled, title: welcomeTitle, body: welcomeBody }) !==
    welcomeBaseline.current
  const navDirty = JSON.stringify(navItems) !== navBaseline.current
  const isDirty = themeDirty || welcomeDirty || navDirty

  // Navigating away with unsaved edits prompts; closing the tab warns too.
  useBlocker({
    shouldBlockFn: () => {
      if (!isDirty || saving) return false
      return !window.confirm('You have unsaved branding changes. Leave without saving?')
    },
    enableBeforeUnload: () => isDirty,
  })

  async function handleSave() {
    // Links with a typed-but-invalid URL would silently vanish from the
    // portal nav — surface it instead of saving.
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
          ...(welcomeDirty
            ? { welcomeCard: { enabled: welcomeEnabled, title: welcomeTitle, body: welcomeBody } }
            : {}),
          ...(navDirty ? { nav: { items } } : {}),
        })
        welcomeBaseline.current = JSON.stringify({
          enabled: welcomeEnabled,
          title: welcomeTitle,
          body: welcomeBody,
        })
        navBaseline.current = JSON.stringify(navItems)
      }

      toast.success('Branding saved')
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save branding. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    state.setCssText(themeBaseline.current.css)
    state.setThemeMode(themeBaseline.current.mode)
    const welcome = JSON.parse(welcomeBaseline.current) as {
      enabled: boolean
      title: string
      body: TiptapContent
    }
    setWelcomeEnabled(welcome.enabled)
    setWelcomeTitle(welcome.title)
    setWelcomeBody(welcome.body)
    setNavItems(JSON.parse(navBaseline.current) as PortalNavItemConfig[])
  }

  // ============================================
  // Preview wiring
  // ============================================
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Which built-in tabs are currently unavailable (product/tab off) — the
  // editor keeps their rows but renders them inert. Mirrors portal-header.
  const gatedTypes = useMemo(() => {
    const flags = settings?.featureFlags
    const gates: Record<PortalBuiltInNavType, boolean> = {
      feedback: isProductEnabled(flags, 'feedback'),
      roadmap: isProductEnabled(flags, 'feedback'),
      changelog:
        isProductEnabled(flags, 'changelog') &&
        (settings?.changelogConfig?.portalTabEnabled ?? true),
      help: isProductEnabled(flags, 'helpCenter') && !!settings?.helpCenterConfig?.enabled,
      support:
        !!flags?.supportTickets ||
        (!!flags?.supportInbox && !!settings?.portalConfig?.support?.enabled),
      status:
        isProductEnabled(flags, 'status') &&
        !!settings?.statusConfig?.enabled &&
        (settings?.statusConfig?.portalTabEnabled ?? true),
    }
    return new Set(
      (Object.keys(gates) as PortalBuiltInNavType[]).filter((type) => !gates[type])
    ) as ReadonlySet<string>
  }, [settings])

  // Structural drafts pushed into the preview iframe (postMessage, no reload).
  const previewDraft = useMemo<PortalPreviewDraft>(
    () => ({
      nav: { items: navItems },
      welcomeCard: {
        enabled: welcomeEnabled,
        title: welcomeTitle,
        body: welcomeBody,
      } satisfies PortalWelcomeCard,
    }),
    [navItems, welcomeEnabled, welcomeTitle, welcomeBody]
  )

  // Saved-config remount signal: changes exactly when a save (or upload) lands.
  const refreshKey = useMemo(
    () => JSON.stringify([brandingConfig, customCss, config, logoData]),
    [brandingConfig, customCss, config, logoData]
  )

  return (
    <div className="space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={PaintBrushIcon}
        title="Branding"
        description="Everything visitors see on your portal — identity, theme, navigation, and content"
      />

      {/* Controls left, live portal preview right (sticky). */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <SettingsCard
            title="Identity"
            description="The portal header shows your logo and workspace name; the name is edited under General settings"
          >
            <div className="flex flex-wrap items-start gap-6">
              <LogoUploader workspaceName={workspaceName} onLogoChange={state.setLogoUrl} />
            </div>
          </SettingsCard>

          <SettingsCard title="Appearance" description="Theme mode, color palette, and typography">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Theme mode</Label>
                <Select
                  value={state.themeMode}
                  onValueChange={(v) => state.setThemeMode(v as ThemeMode)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User choice (allow toggle)</SelectItem>
                    <SelectItem value="light">Light only</SelectItem>
                    <SelectItem value="dark">Dark only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preset</Label>
                <div className="grid grid-cols-3 gap-2">
                  {primaryPresetIds.map((presetId) => {
                    const preset = themePresets[presetId]
                    if (!preset) return null
                    const isActive = state.activePresetId === presetId
                    return (
                      <button
                        key={presetId}
                        onClick={() => state.setPreset(presetId)}
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
                <Label className="text-xs text-muted-foreground">Font</Label>
                <Select
                  value={state.currentFontId}
                  onValueChange={(id) => {
                    const selectedFont = FONT_OPTIONS.find((f) => f.id === id)
                    if (selectedFont) state.setFont(selectedFont.value)
                  }}
                  onOpenChange={(open) => {
                    // Every option previews its own name in its own font, all
                    // rendered at once — load every family the first time the
                    // menu opens rather than trying to lazily match hover.
                    if (open) {
                      for (const f of FONT_OPTIONS) loadBrandingFont(f.id)
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      <span style={{ fontFamily: state.font }}>
                        {FONT_OPTIONS.find((f) => f.id === state.currentFontId)?.name ||
                          'Select font'}
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
                <Label className="text-xs text-muted-foreground">Corner Roundness</Label>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-12">Sharp</span>
                  <Slider
                    value={[state.radius * 100]}
                    onValueChange={([v]) => state.setRadius(v / 100)}
                    min={0}
                    max={100}
                    step={5}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-12 text-right">Round</span>
                  <div
                    className="h-6 w-6 bg-primary shrink-0"
                    style={{ borderRadius: `${state.radius}rem` }}
                  />
                </div>
              </div>

              <details className="group rounded-lg border border-border/60 bg-muted/30">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-muted-foreground group-open:text-foreground [&::-webkit-details-marker]:hidden">
                  Advanced CSS
                  <span className="ms-auto flex items-center gap-3">
                    <a
                      href="https://tweakcn.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Design at tweakcn.com
                    </a>
                    <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <Suspense fallback={<CustomCssEditorFallback />}>
                    <CustomCssEditor value={state.cssText} onChange={state.setCssText} />
                  </Suspense>
                </div>
              </details>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Navigation"
            description="The portal's top tabs — applies everywhere the portal header shows, including help center and status pages"
          >
            <PortalNavEditor
              items={navItems}
              onChange={setNavItems}
              gatedTypes={gatedTypes}
              onReset={() => setNavItems(seedNavEditorItems(null))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Renamed tabs show your text in every language; untouched labels stay translated.
            </p>
          </SettingsCard>

          <SettingsCard
            title="Welcome card"
            description="A customizable message above the post list on your portal home"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <Label htmlFor="welcome-enabled" className="text-sm font-medium cursor-pointer">
                    Enable welcome card
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Shown at the top of the portal home page above the post list
                  </p>
                </div>
                <Switch
                  id="welcome-enabled"
                  checked={welcomeEnabled}
                  onCheckedChange={setWelcomeEnabled}
                  aria-label="Enable welcome card"
                />
              </div>

              {/* Title and message stay editable when the card is disabled so
                  admins can draft the next announcement without it going live
                  the moment they flip the switch on. */}
              <div className="space-y-1.5">
                <Label htmlFor="welcome-title" className="text-sm font-medium">
                  Title
                </Label>
                <Input
                  id="welcome-title"
                  value={welcomeTitle}
                  onChange={(e) => setWelcomeTitle(e.target.value)}
                  placeholder="Share your product feedback!"
                  maxLength={PORTAL_WELCOME_CARD_TITLE_MAX}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Message</Label>
                <WelcomeBodyEditor value={welcomeBody} onChange={setWelcomeBody} />
              </div>
            </div>
          </SettingsCard>
        </div>

        {/* ── Live portal preview ── */}
        <div className="xl:sticky xl:top-6 min-w-0 self-start">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-medium">Live preview</span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              the real portal, shown as you see it
            </span>
            <div className="ms-auto flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                <PreviewToggleButton
                  active={state.previewMode === 'light'}
                  disabled={state.previewModeDisabled === 'light'}
                  onClick={() => state.setPreviewMode('light')}
                  icon={SunIcon}
                  label="Light"
                />
                <PreviewToggleButton
                  active={state.previewMode === 'dark'}
                  disabled={state.previewModeDisabled === 'dark'}
                  onClick={() => state.setPreviewMode('dark')}
                  icon={MoonIcon}
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
              <Button variant="outline" size="sm" asChild>
                <a href="/" target="_blank" rel="noopener noreferrer">
                  Open portal
                  <ArrowTopRightOnSquareIcon className="size-3.5 ms-1.5" />
                </a>
              </Button>
            </div>
          </div>

          {mounted && (
            <PortalPreview
              theme={state.previewMode}
              refreshKey={refreshKey}
              draftCss={state.cssText}
              draft={previewDraft}
              viewport={viewport}
              workspaceName={workspaceName}
              faviconUrl={logoData?.url ?? null}
            />
          )}
        </div>
      </div>

      {/* Contextual save bar — appears only with unsaved changes. */}
      <div
        role="region"
        aria-live="polite"
        className={cn(
          'fixed bottom-5 left-1/2 z-40 -translate-x-1/2 transition-all duration-200',
          isDirty
            ? 'visible translate-y-0 opacity-100'
            : 'invisible pointer-events-none translate-y-16 opacity-0'
        )}
      >
        <div className="flex items-center gap-1.5 rounded-xl bg-foreground py-1.5 ps-4 pe-1.5 text-background shadow-xl">
          <span className="me-2 text-[13px] text-background/75">Unsaved changes</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-background/75 hover:bg-background/10 hover:text-background"
            onClick={handleDiscard}
            disabled={saving}
          >
            Discard
          </Button>
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <ArrowPathIcon className="me-1.5 size-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Isolated so the rich-text editor's heavy deps don't re-render the page. */
function WelcomeBodyEditor({
  value,
  onChange,
}: {
  value: TiptapContent
  onChange: (v: TiptapContent) => void
}) {
  const { upload: uploadImage } = useImageUpload({ prefix: 'portal-welcome' })
  return (
    <RichTextEditor
      value={value}
      onChange={(json: JSONContent) => onChange(json as TiptapContent)}
      placeholder="Tell visitors what kind of feedback you'd love to hear…"
      minHeight="160px"
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
// Identity uploaders
// ==============================================

const RASTER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface LogoUploaderProps {
  workspaceName: string
  onLogoChange?: (url: string | null) => void
}

function LogoUploader({ workspaceName, onLogoChange }: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  const { data: logoData } = useSettingsLogo()
  const uploadMutation = useUploadWorkspaceLogo()
  const deleteMutation = useDeleteWorkspaceLogo()

  const logoUrl = logoData?.url ?? null
  const hasCustomLogo = !!logoUrl

  // Sync logo changes to parent
  useEffect(() => {
    onLogoChange?.(logoUrl)
  }, [logoUrl, onLogoChange])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    setCropImageSrc(URL.createObjectURL(file))
    setShowCropper(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    uploadMutation.mutate(croppedBlob, {
      onSuccess: () => toast.success('Logo updated'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Failed to upload logo'),
    })
  }

  const handleCropperClose = (open: boolean) => {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending}
        className="relative group cursor-pointer"
        aria-label="Change workspace logo"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={workspaceName}
            className="h-14 w-14 rounded-xl object-cover border border-border transition-opacity group-hover:opacity-80"
          />
        ) : (
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-semibold border border-border transition-opacity group-hover:opacity-80">
            {workspaceName.charAt(0).toUpperCase() || 'W'}
          </div>
        )}
        <UploaderOverlay busy={uploadMutation.isPending} />
      </button>
      <span className="text-[11px] text-muted-foreground">Logo</span>
      {hasCustomLogo && (
        <RemoveAssetButton
          pending={deleteMutation.isPending}
          onClick={() =>
            deleteMutation.mutate(undefined, {
              onSuccess: () => {
                toast.success('Logo removed')
                onLogoChange?.(null)
              },
              onError: (error) =>
                toast.error(error instanceof Error ? error.message : 'Failed to remove logo'),
            })
          }
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          open={showCropper}
          onOpenChange={handleCropperClose}
          onCropComplete={handleCropComplete}
          aspectRatio={1}
          maxOutputSize={512}
          title="Crop your logo"
        />
      )}
    </div>
  )
}

function UploaderOverlay({ busy }: { busy: boolean }) {
  return busy ? (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
      <ArrowPathIcon className="h-5 w-5 animate-spin text-white" />
    </div>
  ) : (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
      <CameraIcon className="h-5 w-5 text-white" />
    </div>
  )
}

function RemoveAssetButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
    >
      {pending ? 'Removing…' : 'Remove'}
    </button>
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
