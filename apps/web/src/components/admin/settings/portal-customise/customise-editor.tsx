import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PortalIcon } from '@/lib/shared/schemas/portal-customise'
import { ClientOnly } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/20/solid'
// The 24 set for these: the theme switcher already loads its sun, moon and
// desktop, and the Help Center's category icons own the 20 set's phone. An
// icon two pages share is a request of its own on both.
import {
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/solid'
import { Button, NewTabHint } from '@/components/ui/button'
import { useStableCallback } from '@/lib/client/hooks/use-stable-callback'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'
import {
  tryCssColorToHex,
  type ButtonShape,
  type CardStyle,
  type CustomFont,
  type ThemeMode,
} from '@/lib/shared/theme'
import { loadBrandingFont } from '@/lib/client/hooks/use-branding-font'
import {
  PortalPreview,
  type PreviewDevice,
  type PreviewFit,
} from '@/components/admin/settings/branding/portal-preview'
import { buildInitialCss } from '@/components/admin/settings/branding/theme-css'
import { seedNavEditorItems } from '@/components/public/portal-header-nav'
import type {
  PortalPreviewDraft,
  PreviewEditLabels,
  PreviewEditTarget,
} from '@/components/public/preview-draft-context'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'
import { usePortalEditor, type CompareView, type PortalEditor } from './use-portal-editor'
import { useChangeFlash } from './use-change-flash'
import { CompareLabel, CompareSwitch } from './compare-switch'
import { PortalEditorDialogs } from './editor-dialogs'
import {
  draftFont,
  draftFontName,
  draftHeadingFont,
  darkSurfaceOf,
  draftPalette,
  draftRadius,
  draftRemainder,
  editLogo,
  editTheme,
  editHeaderName,
  isShownHeaderLink,
  shownName,
  showsWide,
  iconUrl,
  wideLogoUrl,
  type HelpCenterHomeDraft,
  type LoadedPortal,
  type PortalDraft,
} from './portal-draft'
import { CustomiseTopBar } from './top-bar'
import { ColoursSection, type SetColour } from './colours-section'
import { cornersName, fontOptionOf, FontShapeSection } from './font-shape-section'
import { HeaderTabsSection } from './header-tabs-section'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { AdvancedCssDrawer, AdvancedCssSection, advancedCssSummary } from './advanced-css-section'
import { HelpCenterHomeSection, PageNote, WelcomeSection } from './page-sections'
import { ImportOverlay } from './import-overlay'
import { importBrief, ImportSection, importSummary, useBrandImport } from './import-section'
import { AskDock } from './ask-dock'
import { siteColoursOf } from './brand-apply'
import { track } from '@/lib/client/analytics'
import {
  pageOfPath,
  sectionForTarget,
  type CustomisePage,
  type CustomisePageId,
  type SectionId,
} from './pages'

/** The section each clickable part of the preview opens, named in the frame's hover chip. */
const EDIT_LABELS: PreviewEditLabels = {
  header: 'Header and tabs',
  logo: 'Header and tabs',
  nav: 'Header and tabs',
  welcome: 'Welcome message',
  'hc-home': 'Help Center home',
  colours: 'Colours',
  type: 'Font and shape',
}

/** The change names (see draftChanges) each section shows a dot for. */
const SECTION_CHANGES: Record<SectionId, string[]> = {
  import: [],
  colours: ['Light and dark', 'Colours'],
  font: ['Font', 'Headings', 'Cards', 'Corners', 'Buttons'],
  header: ['Portal name', 'Logo', 'Tabs'],
  css: ['Advanced CSS'],
  welcome: ['Welcome message'],
  'hc-home': ['Help Center title', 'Help Center description', 'Help Center links'],
}

const MODE_NAMES: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', user: 'Both' }

interface CustomiseEditorProps {
  loaded: LoadedPortal
  /** The pages the preview offers (products that are off, and a Help Center on its own domain, are left out). */
  pages: CustomisePage[]
  /** Built-in tabs whose product is off: their rows stay, inert. */
  gatedTypes: ReadonlySet<string>
  /** The web address a tab is served at, when it has its own. */
  sectionHosts?: Partial<Record<PortalSection, string>>
  /** The viewer has the Custom domains tab: each address links there. */
  linkSectionHosts?: boolean
  /** Changes exactly when published values change: the preview reloads then, and only then. */
  refreshKey: string
  /** Whether this person may change the icon (settings.manage). */
  canChangeIcon?: boolean
  /**
   * The website a deep link asked to import, handed over once (see
   * `useImportDeepLink`): Import opens with it filled in and already reading.
   */
  takeLinkedImport?: () => string | null
}

/**
 * Customise: a panel of sections that edit one draft, beside a live preview
 * of the real portal, published together. "Whole portal" sections apply
 * everywhere; "This page" follows the page the preview shows.
 */
export function CustomiseEditor({
  loaded,
  pages,
  gatedTypes,
  sectionHosts,
  linkSectionHosts = false,
  refreshKey,
  canChangeIcon = false,
  takeLinkedImport,
}: CustomiseEditorProps) {
  const editor = usePortalEditor(loaded)
  const { draft, baseline, update } = editor
  // The look the preview shows: the draft, or Before or Live to compare with.
  const { shown, view } = editor
  // The parts of the preview to outline after a change.
  const { flash, flashNow, quietly } = useChangeFlash(draft)

  // ---- Preview state ----
  const firstPage = pages[0]
  const [pageId, setPageId] = useState<CustomisePageId>(firstPage?.id ?? 'feedback')
  const page = pages.find((p) => p.id === pageId) ?? firstPage
  const [path, setPath] = useState(page?.path ?? '/')
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [previewChoice, setPreviewChoice] = useState<'light' | 'dark'>('light')
  const forcedMode =
    shown.themeMode === 'dark' ? 'dark' : shown.themeMode === 'light' ? 'light' : null
  const previewMode = forcedMode ?? previewChoice
  const [fit, setFit] = useState<PreviewFit | null>(null)

  const showPage = useCallback(
    (id: CustomisePageId) => {
      const next = pages.find((p) => p.id === id)
      if (!next) return
      setPageId(id)
      setPath(next.path)
    },
    [pages]
  )
  const onLocation = useCallback(
    (location: string) => {
      setPath(location)
      const id = pageOfPath(location)
      if (id && pages.some((p) => p.id === id)) setPageId(id)
    },
    [pages]
  )

  // ---- Panel state: one section open at a time, or the chat over them ----
  const [open, setOpen] = useState<SectionId | null>(null)
  const [cssOpen, setCssOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // Below md the panel and the preview take turns: one shows at a time.
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const openSection = useCallback(
    (section: SectionId | null) => {
      setOpen(section)
      // A page section shows its page.
      if (section === 'welcome') showPage('feedback')
      if (section === 'hc-home') showPage('help')
    },
    [showPage]
  )
  const onPick = useCallback(
    (target: PreviewEditTarget) => {
      const { section, page: needs } = sectionForTarget(target)
      if (needs) showPage(needs)
      setChatOpen(false)
      setOpen(section)
    },
    [showPage]
  )
  // A chat reply's line opens the section that makes that change, in view.
  const openFromChat = useCallback(
    (section: SectionId) => {
      openSection(section)
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-section="${section}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      )
    },
    [openSection]
  )

  // ---- Writes ----
  const setThemeMode = useCallback(
    (themeMode: ThemeMode) => update((d) => ({ ...d, themeMode })),
    [update]
  )
  const setColour: SetColour = useCallback(
    (role, mode, hex) =>
      update((d) => editTheme.setColour(d, role, mode, hex), `colour:${role}:${mode}`),
    [update]
  )
  const setFont = useCallback(
    (value: string) => update((d) => editTheme.setFont(d, value)),
    [update]
  )
  const setUploadedFont = useCallback(
    (font: CustomFont, fallbackValue: string) =>
      update((d) => editTheme.setUploadedFont(d, font, fallbackValue)),
    [update]
  )
  const setHeadingFont = useCallback(
    (value: string | null) => update((d) => editTheme.setHeadingFont(d, value)),
    [update]
  )
  const setUploadedHeadingFont = useCallback(
    (font: CustomFont) => update((d) => editTheme.setUploadedHeadingFont(d, font)),
    [update]
  )
  const setCardStyle = useCallback(
    (cardStyle: CardStyle) => update((d) => editTheme.setCardStyle(d, cardStyle)),
    [update]
  )
  const setRadius = useCallback(
    (rem: number) => update((d) => editTheme.setRadius(d, rem)),
    [update]
  )
  const setButtonShape = useCallback(
    (buttonShape: ButtonShape) => update((d) => ({ ...d, buttonShape })),
    [update]
  )
  const setNav = useCallback(
    (nav: PortalNavItemConfig[]) => update((d) => ({ ...d, nav }), 'nav'),
    [update]
  )
  const resetNav = useCallback(
    () => update((d) => ({ ...d, nav: seedNavEditorItems(null) })),
    [update]
  )
  // The header's colour where the portal is dark, for whether the logo shows on it.
  const darkSurface = useMemo(() => darkSurfaceOf(draft), [draft])
  const logoControls = useMemo(
    () => ({
      logo: draft.logo,
      canChangeIcon,
      onLogoUploaded: (key: string) => update((d) => editLogo.setUploadedWide(d, key)),
      onDarkUploaded: (key: string) => update((d) => editLogo.setUploadedDark(d, key)),
      onRemoveDark: () => update(editLogo.removeDark),
      darkSurface,
      onIconUploaded: (icon: PortalIcon) => update((d) => editLogo.setUploadedIcon(d, icon)),
      onShowLogo: () => update(editLogo.showWide),
      onShowIconAndName: () => update(editLogo.showSquare),
      onRemoveLogo: () => update(editLogo.removeWide),
    }),
    [draft.logo, canChangeIcon, update, darkSurface]
  )
  const setHeaderName = useCallback(
    (name: string) => update((d) => editHeaderName(d, name), 'header-name'),
    [update]
  )
  const setWelcomeBody = useCallback(
    (welcomeBody: TiptapContent) => update((d) => ({ ...d, welcomeBody }), 'welcome'),
    [update]
  )
  const setHelpCenter = useCallback(
    (helpCenter: HelpCenterHomeDraft, burst?: string) =>
      update((d) => ({ ...d, helpCenter }), burst),
    [update]
  )
  const setCssText = useCallback(
    (css: string) => update((d) => editTheme.setCssText(d, css), 'css'),
    [update]
  )
  // Stepping through history is not a change to point at.
  const { undo: stepBack, redo: stepForward } = editor
  const undo = useCallback(() => {
    quietly()
    stepBack()
  }, [quietly, stepBack])
  const redo = useCallback(() => {
    quietly()
    stepForward()
  }, [quietly, stepForward])
  const resetTheme = useCallback(() => {
    update((d) => editTheme.setCssText(d, buildInitialCss('', {})))
    toast('Default theme restored.', { action: { label: 'Undo', onClick: undo } })
  }, [update, undo])

  // ---- Keyboard: publish, undo, redo ----
  useEditorShortcuts(editor.publish, undo, redo)

  // ---- Import your brand, and Ask ----
  useEffect(() => {
    void track('portal_customise_opened')
  }, [])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const getDraft = useCallback(() => draftRef.current, [])
  // An import lands in one step: the preview outlines it at once, as it does a chat change.
  const updateNow = useCallback(
    (edit: (draft: PortalDraft) => PortalDraft) => {
      flashNow()
      update(edit)
    },
    [flashNow, update]
  )
  // A suggestion used in Import is replied to in the dock like a chat change, with its one Undo.
  const [notice, setNotice] = useState<{
    id: number
    before: PortalDraft
    after: PortalDraft
  } | null>(null)
  const onSuggestionUsed = useCallback(
    (before: PortalDraft, after: PortalDraft) =>
      setNotice((last) => ({ id: (last?.id ?? 0) + 1, before, after })),
    []
  )
  const brandImport = useBrandImport({ update: updateNow, getDraft, onSuggestionUsed })
  // A publish of the imported logo, icon or font asks first, and records who confirmed them.
  const { setImportedBrand } = editor
  useEffect(() => {
    setImportedBrand(brandImport.state.status === 'done' ? brandImport.state.brand : null)
  }, [brandImport.state, setImportedBrand])
  const [fontUploadRequest, setFontUploadRequest] = useState<{
    family: string
    at: number
  } | null>(null)
  // One identity for the editor's lifetime: the dock below is memoised, and
  // the import's state changes as it runs.
  const importFor = useStableCallback((host: string) => {
    setOpen('import')
    void brandImport.run(host)
  })
  // The launch plan's "Import from {domain}": that press was the choice, so
  // the import starts on arrival. It fills the draft and publishes nothing.
  const [linkedSite, setLinkedSite] = useState<string | undefined>(undefined)
  const importLinked = useRef(importFor)
  importLinked.current = importFor
  useEffect(() => {
    const site = takeLinkedImport?.()
    if (!site) return
    setLinkedSite(site)
    importLinked.current(site)
  }, [takeLinkedImport])
  const siteColours = useMemo(
    () => siteColoursOf(brandImport.state.status === 'done' ? brandImport.state.brand : null),
    [brandImport.state]
  )
  // The chat's reply to an import it started follows the import in one line.
  const brief = useMemo(() => importBrief(brandImport.state), [brandImport.state])
  // A phone shows the portal as a phone does.
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 767px)').matches) setDevice('mobile')
  }, [])

  // ---- Derived values ----
  const font = draftFont(draft)
  const radius = draftRadius(draft)
  const light = useMemo(() => draftPalette(draft, 'light'), [draft])
  const dark = useMemo(() => draftPalette(draft, 'dark'), [draft])
  const remainder = useMemo(() => draftRemainder(draft), [draft])
  const fontOption = fontOptionOf(font)
  useEffect(() => {
    if (fontOption) loadBrandingFont(fontOption.id)
  }, [fontOption])
  const changed = (section: SectionId) =>
    SECTION_CHANGES[section].some((change) => editor.changes.includes(change))

  // ---- What the preview gets ----
  const previewDraft = useMemo<PortalPreviewDraft>(
    () => ({
      nav: { items: shown.nav },
      welcomeCard: { body: shown.welcomeBody },
      buttonShape: shown.buttonShape,
      ...(shown.customFont ? { customFont: shown.customFont } : {}),
      cardStyle: shown.cardStyle,
      ...(shown.customHeadingFont ? { customHeadingFont: shown.customHeadingFont } : {}),
      ...(shown.headingScope ? { headingScope: shown.headingScope } : {}),
      name: shownName(shown),
      logo: {
        url:
          shown.logo.mode === 'custom_logo' && shown.logo.wideKey
            ? wideLogoUrl(shown.logo.wideKey)
            : shown.logo.icon
              ? iconUrl(shown.logo.icon.key)
              : null,
        // The dark mode version, where the header shows the logo it stands in for.
        darkUrl:
          shown.logo.mode === 'custom_logo' && shown.logo.wideKey && shown.logo.darkKey
            ? wideLogoUrl(shown.logo.darkKey)
            : null,
        mode:
          shown.logo.mode === 'custom_logo' && !shown.logo.wideKey
            ? 'logo_and_name'
            : shown.logo.mode,
      },
      ...(shown.helpCenter
        ? {
            helpCenter: {
              homepageTitle: shown.helpCenter.homepageTitle,
              homepageDescription: shown.helpCenter.homepageDescription,
              headerLinks: shown.helpCenter.headerLinks.filter(isShownHeaderLink),
            },
          }
        : {}),
    }),
    [
      shown.nav,
      shown.welcomeBody,
      shown.buttonShape,
      shown.customFont,
      shown.cardStyle,
      shown.customHeadingFont,
      shown.headingScope,
      shown.headerName,
      shown.workspaceName,
      shown.logo,
      shown.helpCenter,
    ]
  )
  // Live is the baseline itself, so nothing is unsaved and the frame shows the saved config.
  const structureDirty =
    shown.nav !== baseline.nav ||
    shown.welcomeBody !== baseline.welcomeBody ||
    shown.buttonShape !== baseline.buttonShape ||
    shown.customFont !== baseline.customFont ||
    shown.cardStyle !== baseline.cardStyle ||
    shown.customHeadingFont !== baseline.customHeadingFont ||
    shown.headingScope !== baseline.headingScope ||
    shown.headerName !== baseline.headerName ||
    shown.logo !== baseline.logo ||
    shown.helpCenter !== baseline.helpCenter
  // The card style and the headings font are worked out in the frame from
  // the stylesheet (the colours a flat card sits on, the font a heading
  // falls back to), so a change to either sends the stylesheet too.
  const cssDirty =
    shown.cssText !== baseline.cssText ||
    shown.cardStyle !== baseline.cardStyle ||
    shown.customHeadingFont !== baseline.customHeadingFont

  const primaryHex = tryCssColorToHex((draft.themeMode === 'dark' ? dark : light).primary ?? '')
  // One identity each for the editor's lifetime: the top bar is memoised.
  const discard = useStableCallback(() => {
    quietly()
    editor.discard()
    toast('Changes discarded.', { action: { label: 'Undo', onClick: undo } })
  })
  const publish = useStableCallback(() => void editor.publish())
  const togglePreviewMode = useCallback(
    () => setPreviewChoice(previewMode === 'light' ? 'dark' : 'light'),
    [previewMode]
  )

  return (
    <div className="flex h-full flex-col">
      <CustomiseTopBar
        changes={editor.changes.length}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        publishing={editor.publishing}
        onUndo={undo}
        onRedo={redo}
        onDiscard={discard}
        onPublish={publish}
      />

      <MobileViewTabs view={mobileView} onView={setMobileView} />

      <div className="flex min-h-0 flex-1">
        {/* ── Panel ── */}
        <div
          className={cn(
            'flex w-full flex-col border-border md:w-[332px] md:shrink-0 md:border-e',
            mobileView === 'preview' && 'max-md:hidden'
          )}
        >
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-6', chatOpen && 'hidden')}>
            <GroupLabel>Whole portal</GroupLabel>
            <PanelSection
              id="import"
              title="Import your brand"
              open={open}
              onToggle={openSection}
              changed={false}
              value={importSummary(brandImport.state)}
            >
              <ImportSection
                state={brandImport.state}
                onRun={(input) => void brandImport.run(input)}
                onUndoRow={brandImport.undoRow}
                onUndoAll={brandImport.undoAll}
                onUploadWide={() => openSection('header')}
                onUploadFont={(family) => {
                  setFontUploadRequest({ family, at: Date.now() })
                  openSection('font')
                }}
                suggestions={brandImport.suggestions}
                onUseSuggestion={brandImport.useSuggestion}
                initialSite={linkedSite}
              />
            </PanelSection>
            <PanelSection
              id="colours"
              title="Colours"
              open={open}
              onToggle={openSection}
              changed={changed('colours')}
              value={
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full border border-border/70"
                    style={{ backgroundColor: primaryHex ?? undefined }}
                  />
                  {primaryHex} · {MODE_NAMES[draft.themeMode]}
                </span>
              }
            >
              <ColoursSection
                themeMode={draft.themeMode}
                light={light}
                dark={dark}
                setThemeMode={setThemeMode}
                setColour={setColour}
                siteColours={siteColours}
              />
            </PanelSection>
            <PanelSection
              id="font"
              title="Font and shape"
              open={open}
              onToggle={openSection}
              changed={changed('font')}
              value={`${draftFontName(draft)} · ${cornersName(radius)}`}
            >
              <FontShapeSection
                font={font}
                headingFont={draftHeadingFont(draft)}
                radius={radius}
                buttonShape={draft.buttonShape}
                cardStyle={draft.cardStyle}
                customFont={draft.customFont}
                customHeadingFont={draft.customHeadingFont}
                setFont={setFont}
                setUploadedFont={setUploadedFont}
                setHeadingFont={setHeadingFont}
                setUploadedHeadingFont={setUploadedHeadingFont}
                setRadius={setRadius}
                setButtonShape={setButtonShape}
                setCardStyle={setCardStyle}
                uploadRequest={fontUploadRequest}
              />
            </PanelSection>
            <PanelSection
              id="header"
              title="Header and tabs"
              open={open}
              onToggle={openSection}
              changed={changed('header')}
              value={`${showsWide(draft) ? 'Logo' : 'Icon and name'} · ${tabsSummary(draft.nav, gatedTypes)}`}
            >
              <HeaderTabsSection
                workspaceName={draft.workspaceName}
                headerName={draft.headerName}
                setHeaderName={setHeaderName}
                nav={draft.nav}
                setNav={setNav}
                resetNav={resetNav}
                gatedTypes={gatedTypes}
                logo={logoControls}
                sectionHosts={sectionHosts}
                linkSectionHosts={linkSectionHosts}
              />
            </PanelSection>
            <PanelSection
              id="css"
              title="Advanced CSS"
              open={open}
              onToggle={openSection}
              changed={changed('css')}
              value={advancedCssSummary(remainder, editor.parked)}
            >
              <AdvancedCssSection onOpenEditor={() => setCssOpen(true)} onReset={resetTheme} />
            </PanelSection>

            {page ? (
              <>
                <GroupLabel>
                  This page <span className="font-normal text-foreground">· {page.label}</span>
                </GroupLabel>
                {page.section === 'welcome' ? (
                  <PanelSection
                    id="welcome"
                    title="Welcome message"
                    open={open}
                    onToggle={openSection}
                    changed={changed('welcome')}
                    value={isEmptyTiptapDoc(draft.welcomeBody) ? 'Off' : 'Shown'}
                  >
                    <WelcomeSection value={draft.welcomeBody} onChange={setWelcomeBody} />
                  </PanelSection>
                ) : page.section === 'hc-home' ? (
                  draft.helpCenter ? (
                    <PanelSection
                      id="hc-home"
                      title="Help Center home"
                      open={open}
                      onToggle={openSection}
                      changed={changed('hc-home')}
                      value={draft.helpCenter.homepageTitle || 'How can we help?'}
                    >
                      <HelpCenterHomeSection value={draft.helpCenter} onChange={setHelpCenter} />
                    </PanelSection>
                  ) : (
                    <p className="py-3 text-xs text-muted-foreground">
                      The Help Center home is set by people who manage the Help Center.
                    </p>
                  )
                ) : (
                  <div className="py-3">
                    <PageNote page={page.id === 'roadmap' ? 'roadmap' : 'changelog'} />
                  </div>
                )}
              </>
            ) : null}
          </div>
          <AskDock
            getDraft={getDraft}
            update={update}
            undo={undo}
            onImport={importFor}
            onChanged={flashNow}
            page={pageId}
            importBrief={brief}
            notice={notice}
            chatOpen={chatOpen}
            onChatOpenChange={setChatOpen}
            onOpenSection={openFromChat}
          />
        </div>

        {/* ── Canvas ── */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col bg-muted/40',
            mobileView === 'edit' && 'max-md:hidden'
          )}
        >
          <CanvasToolbar
            pages={pages}
            pageId={pageId}
            onPage={showPage}
            device={device}
            onDevice={setDevice}
            previewMode={previewMode}
            forcedMode={forcedMode}
            onToggleMode={togglePreviewMode}
            fit={fit}
            view={view}
            canBefore={editor.canBefore}
            canLive={editor.canLive}
            onView={editor.setView}
          />
          <div className="flex min-h-0 flex-1">
            {cssOpen ? (
              <AdvancedCssDrawer
                value={draft.cssText}
                ownRules={remainder !== ''}
                onChange={setCssText}
                onClose={() => setCssOpen(false)}
              />
            ) : null}
            {/* The iframe waits for hydration. */}
            <ClientOnly>
              <PortalPreview
                theme={previewMode}
                path={path}
                refreshKey={refreshKey}
                draftCss={shown.cssText}
                cssDirty={cssDirty}
                draft={previewDraft}
                // With a draft stylesheet the frame needs the draft's other
                // settings too: what the headings and cards are is in both.
                draftDirty={structureDirty || cssDirty}
                device={device}
                editLabels={EDIT_LABELS}
                onLocation={onLocation}
                onPick={onPick}
                onFit={setFit}
                flushKey={brandImport.state.status === 'done' ? brandImport.state.brand : null}
                flash={flash}
                overlay={
                  <>
                    <ImportOverlay state={brandImport.state} />
                    <CompareLabel view={view} />
                  </>
                }
                className="min-w-0 flex-1"
              />
            </ClientOnly>
          </div>
        </div>
      </div>

      <PortalEditorDialogs
        editor={editor}
        onPublishAssets={(keep, drop) => {
          const check = editor.assetCheck
          if (!check) return
          // Dropped assets go back to what the draft had before the import, as one step.
          const next = brandImport.dropAssets(drop)
          void editor.publish({ parkCss: check.parkCss, draft: next, confirmed: keep })
        }}
      />
    </div>
  )
}

function tabsSummary(nav: PortalNavItemConfig[], gated: ReadonlySet<string>): string {
  const shown = nav.filter(
    (item) => item.enabled !== false && !gated.has(item.type) && (item.type !== 'link' || item.url)
  ).length
  return shown === 1 ? '1 tab' : `${shown} tabs`
}

/** Ctrl or Cmd with S publishes; Z undoes, Shift Z redoes, except while typing in a field. */
function useEditorShortcuts(publish: PortalEditor['publish'], undo: () => void, redo: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void publish()
        return
      }
      if (key !== 'z') return
      const target = event.target as HTMLElement | null
      // Fields keep their own undo.
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [publish, undo, redo])
}

/** Below md: Edit or Preview, one at a time. Both stay mounted; the preview keeps its frame. */
const MobileViewTabs = memo(function MobileViewTabs({
  view,
  onView,
}: {
  view: 'edit' | 'preview'
  onView: (view: 'edit' | 'preview') => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Customise"
      className="flex h-10 shrink-0 items-stretch border-b border-border px-3 md:hidden"
    >
      {(['edit', 'preview'] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onView(id)}
          className={cn(
            '-mb-px flex-1 border-b-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            view === id
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground'
          )}
        >
          {id === 'edit' ? 'Edit' : 'Preview'}
        </button>
      ))}
    </div>
  )
})

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="pt-4 pb-1 text-xs font-medium text-muted-foreground">{children}</p>
}

/** One accordion section: a row that shows its value while closed, its controls while open. */
function PanelSection({
  id,
  title,
  value,
  changed,
  open,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  value: ReactNode
  changed: boolean
  open: SectionId | null
  onToggle: (id: SectionId | null) => void
  children: ReactNode
}) {
  const isOpen = open === id
  const panelId = `customise-section-${id}`
  return (
    <section className="border-b border-border" data-section={id}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => onToggle(isOpen ? null : id)}
        className="flex w-full items-center gap-2 py-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="text-sm font-medium">{title}</span>
        {changed ? (
          <span className="size-1.5 rounded-full bg-primary" aria-label="Changed" />
        ) : null}
        <span className="ms-auto flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{value}</span>
          {isOpen ? (
            <ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
          )}
        </span>
      </button>
      {isOpen ? (
        <div id={panelId} className="pb-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}

const DEVICES: Array<{ value: PreviewDevice; label: string; icon: typeof ComputerDesktopIcon }> = [
  { value: 'desktop', label: 'Desktop', icon: ComputerDesktopIcon },
  { value: 'tablet', label: 'Tablet', icon: DeviceTabletIcon },
  { value: 'mobile', label: 'Mobile', icon: DevicePhoneMobileIcon },
]

/** Page, device, Before/After/Live, light or dark, the zoom, and the live portal. */
/**
 * The canvas's controls. Each is memoised on its own: an edit changes what
 * there is to compare with (Before and Live), and nothing else here, so the
 * page list, the devices and the mode switch stay as they were. Every prop
 * must keep its identity while its value does.
 */
function CanvasToolbar({
  pages,
  pageId,
  onPage,
  device,
  onDevice,
  previewMode,
  forcedMode,
  onToggleMode,
  fit,
  view,
  canBefore,
  canLive,
  onView,
}: {
  pages: CustomisePage[]
  pageId: CustomisePageId
  onPage: (id: CustomisePageId) => void
  device: PreviewDevice
  onDevice: (device: PreviewDevice) => void
  previewMode: 'light' | 'dark'
  forcedMode: 'light' | 'dark' | null
  onToggleMode: () => void
  fit: PreviewFit | null
  view: CompareView
  canBefore: boolean
  canLive: boolean
  onView: (view: CompareView) => void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:gap-3">
      <PagePicker pages={pages} pageId={pageId} onPage={onPage} />
      <div className="max-md:hidden">
        <DevicePicker device={device} onDevice={onDevice} />
      </div>
      <CompareSwitch view={view} canBefore={canBefore} canLive={canLive} onView={onView} />
      <PreviewModeToggle
        previewMode={previewMode}
        forcedMode={forcedMode}
        onToggleMode={onToggleMode}
      />
      {fit ? (
        <span className="text-xs tabular-nums text-muted-foreground max-md:hidden">
          {fit.width}px · {Math.round(fit.scale * 100)}%
        </span>
      ) : null}
      <LivePortalLink />
    </div>
  )
}

const PagePicker = memo(function PagePicker({
  pages,
  pageId,
  onPage,
}: {
  pages: CustomisePage[]
  pageId: CustomisePageId
  onPage: (id: CustomisePageId) => void
}) {
  return (
    <Select value={pageId} onValueChange={(id) => onPage(id as CustomisePageId)}>
      <SelectTrigger className="h-8 w-32 md:w-40" aria-label="Page">
        <SelectValue>{pages.find((p) => p.id === pageId)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {pages.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})

const DevicePicker = memo(function DevicePicker({
  device,
  onDevice,
}: {
  device: PreviewDevice
  onDevice: (device: PreviewDevice) => void
}) {
  const onDeviceKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = DEVICES.findIndex((d) => d.value === device)
    const next = DEVICES[(index + step + DEVICES.length) % DEVICES.length]!
    onDevice(next.value)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-device="${next.value}"]`)?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Device"
      onKeyDown={onDeviceKey}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {DEVICES.map(({ value, label, icon: Icon }) => {
        const selected = value === device
        return (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                data-device={value}
                tabIndex={selected ? 0 : -1}
                onClick={() => onDevice(value)}
                className={cn(
                  'flex h-7 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  selected
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})

const PreviewModeToggle = memo(function PreviewModeToggle({
  previewMode,
  forcedMode,
  onToggleMode,
}: {
  previewMode: 'light' | 'dark'
  forcedMode: 'light' | 'dark' | null
  onToggleMode: () => void
}) {
  const ModeIcon = previewMode === 'dark' ? MoonIcon : SunIcon
  const modeLabel = forcedMode
    ? forcedMode === 'dark'
      ? 'Always dark'
      : 'Always light'
    : previewMode === 'dark'
      ? 'Preview in light mode'
      : 'Preview in dark mode'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the reason reachable while the button is disabled. */}
        <span tabIndex={forcedMode ? 0 : -1}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={modeLabel}
            disabled={forcedMode !== null}
            onClick={onToggleMode}
          >
            <ModeIcon className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{modeLabel}</TooltipContent>
    </Tooltip>
  )
})

const LivePortalLink = memo(function LivePortalLink() {
  return (
    <Button variant="ghost" size="icon-sm" asChild className="ms-auto">
      <a href="/" target="_blank" rel="noopener noreferrer" aria-label="Open the live portal">
        <ArrowTopRightOnSquareIcon className="size-4" aria-hidden="true" />
        <NewTabHint />
      </a>
    </Button>
  )
})
