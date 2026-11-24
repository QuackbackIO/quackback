/**
 * The Customise draft: everything the page edits as one value, so one
 * history covers it all, one comparison says what changed, and one publish
 * sends it. Plain functions; usePortalEditor holds the state.
 */
import { tryCssColorToHex } from '@/lib/shared/theme'
import { expandTheme } from '@/lib/shared/theme/expand'
import { PICKED_KEYS } from '@/lib/shared/theme/base'
import {
  applyColour,
  resetColour,
  type ColourMode,
  type ColourRole,
} from '@/lib/shared/theme/colour-setters'
import type {
  ButtonShape,
  CardStyle,
  CustomFont,
  HeadingScope,
  ThemeConfig,
  ThemeMode,
} from '@/lib/shared/theme'
import { seedNavEditorItems } from '@/components/public/portal-header-nav'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'
import type {
  HeaderDisplayMode,
  HelpCenterConfig,
  HelpCenterHeaderLink,
  PortalConfig,
  PortalNavItemConfig,
} from '@/lib/shared/types/settings'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  brandAssetsConfirmationSchema,
  brandImportSchema,
  type PortalCustomiseValues,
  type PortalIcon,
  type PublishPortalCustomisationInput,
  type StoredPortalIcon,
} from '@/lib/shared/schemas/portal-customise'
import type { BrandAsset, BrandImport } from '@/lib/shared/theme/brand-import'
import {
  buildInitialCss,
  editPalettes,
  fontOf,
  headingFontOf,
  palettesOf,
  radiusOf,
  remainderOf,
  themePublishOf,
  type Palette,
} from '@/components/admin/settings/branding/theme-css'
import { isValidNavLinkUrl } from '@/components/admin/settings/branding/portal-nav-editor'
import { fontDisplayName } from '@/lib/shared/theme/font-names'
import { fontName, SAME_AS_TEXT } from './font-shape-section'

export { SAME_AS_TEXT }

/** The Help Center home's top-level fields (localized copy stays on its settings page). */
export interface HelpCenterHomeDraft {
  homepageTitle: string
  homepageDescription: string
  headerLinks: HelpCenterHeaderLink[]
}

/**
 * The brand's two pieces of artwork, as brand guidelines name them, and
 * what the header shows. The logo (`wideKey`) is the full logo: a wordmark,
 * or the mark and name locked up together, usually wide. The icon is the
 * mark alone in a square, for small places: the browser tab, emails,
 * sign-in, and the header beside the workspace name. Both wait in the draft
 * for a publish; the mode says which of the two the header shows.
 */
export interface LogoDraft {
  wideKey: string | null
  /**
   * The logo's dark mode version: an optional second upload, shown in the
   * logo's place wherever the portal is drawn dark. Absent or null, the logo
   * itself shows in both.
   */
  darkKey?: string | null
  mode: HeaderDisplayMode
  /** The icon and the favicon made from it, or null when the workspace has none. */
  icon: StoredPortalIcon | null
}

export interface PortalDraft {
  /** The whole theme as CSS: generated palettes, then any Advanced CSS rules. */
  cssText: string
  themeMode: ThemeMode
  buttonShape: ButtonShape
  /**
   * An uploaded font family. Its own field, never CSS text: the stylesheet
   * keeps its fallback as the font, and the theme writes the family ahead of it.
   */
  customFont?: CustomFont
  /** How cards stand off the page. A theme setting of its own, as the button shape is. */
  cardStyle: CardStyle
  /** An uploaded family for titles and headings; unset, the stylesheet's headings font or the text font. */
  customHeadingFont?: CustomFont
  /** 'page' keeps the headings font to page headings; post and card titles take the text font. */
  headingScope?: HeadingScope
  /**
   * The name the portal's header shows beside the icon. Empty for none of
   * its own: the header then shows the workspace's name.
   */
  headerName: string
  /** The workspace's name, set on General: emails, sign-in and page titles use it. Never edited here. */
  workspaceName: string
  logo: LogoDraft
  nav: PortalNavItemConfig[]
  welcomeBody: TiptapContent
  /** Null for someone who cannot manage the Help Center: the part is not theirs to publish. */
  helpCenter: HelpCenterHomeDraft | null
}

/** What the page loaded: the published values of every part. */
export interface LoadedPortal {
  theme: ThemeConfig
  customCss: string
  /** The tabs and welcome message: all of the portal config the editor reads. */
  portal: Partial<Pick<PortalConfig, 'nav' | 'welcomeCard'>>
  helpCenter: HelpCenterConfig | null
  /** The workspace's name. */
  name?: string
  /** The name the header shows in its place, when one is set. */
  headerName?: string | null
  /** The logo's key, the header's display mode and the icon. */
  logo?: Omit<LogoDraft, 'icon'> & { icon?: StoredPortalIcon | null }
}

const NO_LOGO: LogoDraft = { wideKey: null, mode: 'logo_and_name', icon: null }

/** Where a stored or staged icon is served from. */
export const iconUrl = (key: string) => `/api/storage/${key}`

/** Where a stored or staged logo is served from: this origin, so an SVG shows inline. */
export const wideLogoUrl = (key: string) => `/api/storage/${key}`

/** A logo draft with no dark version says nothing of one. */
function withoutNoDark(logo: LogoDraft): LogoDraft {
  if (logo.darkKey) return logo
  const { darkKey: _none, ...rest } = logo
  return rest
}

export function draftFromLoaded(loaded: LoadedPortal): PortalDraft {
  return {
    cssText: buildInitialCss(loaded.customCss, loaded.theme),
    themeMode: loaded.theme.themeMode ?? 'user',
    buttonShape: loaded.theme.buttonShape ?? 'pill',
    ...(loaded.theme.customFont ? { customFont: loaded.theme.customFont } : {}),
    cardStyle: loaded.theme.cardStyle ?? 'border',
    ...(loaded.theme.customHeadingFont
      ? { customHeadingFont: loaded.theme.customHeadingFont }
      : {}),
    ...(loaded.theme.headingScope ? { headingScope: loaded.theme.headingScope } : {}),
    headerName: loaded.headerName ?? '',
    workspaceName: loaded.name ?? '',
    logo: withoutNoDark({ ...NO_LOGO, ...loaded.logo }),
    nav: seedNavEditorItems(loaded.portal.nav),
    welcomeBody: loaded.portal.welcomeCard?.body ?? DEFAULT_PORTAL_CONFIG.welcomeCard!.body,
    helpCenter: loaded.helpCenter
      ? {
          homepageTitle: loaded.helpCenter.homepageTitle ?? '',
          homepageDescription: loaded.helpCenter.homepageDescription ?? '',
          headerLinks: loaded.helpCenter.headerLinks ?? [],
        }
      : null,
  }
}

/**
 * The published values as the read path returns them: sent as `before` with
 * each publish, so a change someone else made meanwhile is refused, not lost.
 */
export function publishedFromLoaded(loaded: LoadedPortal): PortalCustomiseValues {
  return {
    headerName: loaded.headerName ?? '',
    theme: loaded.theme,
    customCss: loaded.customCss,
    portal: { nav: loaded.portal.nav ?? null, welcomeCard: loaded.portal.welcomeCard ?? null },
    logo: {
      wideKey: (loaded.logo ?? NO_LOGO).wideKey,
      darkKey: loaded.logo?.darkKey ?? null,
      headerDisplayMode: (loaded.logo ?? NO_LOGO).mode,
      icon: loaded.logo?.icon ?? null,
    },
    ...(loaded.helpCenter
      ? {
          helpCenter: {
            homepageTitle: loaded.helpCenter.homepageTitle,
            homepageDescription: loaded.helpCenter.homepageDescription,
            headerLinks: loaded.helpCenter.headerLinks,
          },
        }
      : {}),
  }
}

// ============================================
// Theme reads and writes
// ============================================

/** One palette as the draft sets it, unbranded values filling any gap. */
export function draftPalette(draft: PortalDraft, mode: ColourMode): Palette {
  return palettesOf(draft.cssText)[mode]
}

/**
 * The header's colour where the portal is drawn dark, for whether the logo
 * shows on it. Nothing for an always light portal, which is never drawn dark.
 */
export function darkSurfaceOf(draft: PortalDraft): string | null {
  if (draft.themeMode === 'light') return null
  const palette = expandTheme(draftPalette(draft, 'dark'), { mode: 'dark' })
  return (
    tryCssColorToHex(palette.header ?? '') ?? tryCssColorToHex(palette.background ?? '') ?? null
  )
}

export const draftFont = (draft: PortalDraft) => fontOf(draft.cssText, draft.themeMode)
/** The font as the panel names it: an uploaded family by its name. */
export const draftFontName = (draft: PortalDraft) =>
  draft.customFont ? fontDisplayName(draft.customFont.family) : fontName(draftFont(draft))
/** The listed font headings are set in, or null when they are set in the text font or an uploaded family. */
export const draftHeadingFont = (draft: PortalDraft) =>
  headingFontOf(draft.cssText, draft.themeMode)
/** The headings font as the panel names it. */
export const draftHeadingName = (draft: PortalDraft) => {
  const listed = draftHeadingFont(draft)
  if (draft.customHeadingFont) return fontDisplayName(draft.customHeadingFont.family)
  return listed ? fontName(listed) : SAME_AS_TEXT
}
export const draftRadius = (draft: PortalDraft) => radiusOf(draft.cssText, draft.themeMode)
/** The Advanced CSS rules of the draft (rules the theme generator would not write). */
export const draftRemainder = (draft: PortalDraft) => remainderOf(draft.cssText)

/** Theme writes. Each regenerates the stylesheet; none patches one variable. */
export const editTheme = {
  /** One colour for light or dark; null puts a background or text colour back on Auto. */
  setColour(draft: PortalDraft, role: ColourRole, mode: ColourMode, hex: string | null) {
    const cssText = editPalettes(draft.cssText, (light, dark) =>
      hex === null
        ? role === 'primary'
          ? { light, dark }
          : resetColour(light, dark, role, mode)
        : applyColour(light, dark, role, mode, hex)
    )
    return cssText === draft.cssText ? draft : { ...draft, cssText }
  },
  /** A listed font; it takes the place of an uploaded one. */
  setFont(draft: PortalDraft, fontValue: string): PortalDraft {
    const { customFont: _uploaded, ...rest } = draft
    return {
      ...rest,
      cssText: editPalettes(draft.cssText, (light, dark) => ({
        light: { ...light, fontSans: fontValue },
        dark: { ...dark, fontSans: fontValue },
      })),
    }
  },
  /** An uploaded family, with the listed font it falls back to as the stylesheet font. */
  setUploadedFont(draft: PortalDraft, font: CustomFont, fallbackValue: string): PortalDraft {
    return { ...editTheme.setFont(draft, fallbackValue), customFont: font }
  },
  /**
   * A listed font for titles and headings, or null for the text font. Either
   * takes the place of an uploaded headings family.
   */
  setHeadingFont(draft: PortalDraft, fontValue: string | null): PortalDraft {
    // A font chosen here is for every title: only Import keeps one to page headings.
    const { customHeadingFont: _uploaded, headingScope: _scope, ...rest } = draft
    const set = ({ fontHeading: _heading, ...palette }: Palette): Palette =>
      fontValue ? { ...palette, fontHeading: fontValue } : palette
    const cssText = editPalettes(draft.cssText, (light, dark) => ({
      light: set(light),
      dark: set(dark),
    }))
    return cssText === draft.cssText && !draft.customHeadingFont && !draft.headingScope
      ? draft
      : { ...rest, cssText }
  },
  /** An uploaded family for titles and headings: its own field, with no stylesheet line. */
  setUploadedHeadingFont(draft: PortalDraft, font: CustomFont): PortalDraft {
    return { ...editTheme.setHeadingFont(draft, null), customHeadingFont: font }
  },
  /** The headings font kept to page headings (a display face), or back on every title. */
  setHeadingScope(draft: PortalDraft, scope: HeadingScope | undefined): PortalDraft {
    if (draft.headingScope === scope) return draft
    const { headingScope: _scope, ...rest } = draft
    return scope ? { ...rest, headingScope: scope } : rest
  },
  setCardStyle(draft: PortalDraft, cardStyle: CardStyle): PortalDraft {
    return cardStyle === draft.cardStyle ? draft : { ...draft, cardStyle }
  },
  setRadius(draft: PortalDraft, rem: number): PortalDraft {
    return {
      ...draft,
      cssText: editPalettes(draft.cssText, (light, dark) => ({
        light: { ...light, radius: `${rem}rem` },
        dark: { ...dark, radius: `${rem}rem` },
      })),
    }
  },
  setCssText(draft: PortalDraft, cssText: string): PortalDraft {
    return cssText === draft.cssText ? draft : { ...draft, cssText }
  },
}

/** The name the header shows: its own, else the workspace's. */
export const shownName = (draft: Pick<PortalDraft, 'headerName' | 'workspaceName'>) =>
  draft.headerName.trim() || draft.workspaceName

/**
 * The draft with a new name in the header. An empty one puts the workspace's
 * name back; the workspace's own name is never changed here.
 */
export function editHeaderName(draft: PortalDraft, name: string): PortalDraft {
  const next = name.slice(0, 100)
  return next === draft.headerName ? draft : { ...draft, headerName: next }
}

/** Logo and icon writes: each upload waits in the draft until a publish. */
export const editLogo = {
  /** A logo just uploaded: the header shows it alone. */
  setUploadedWide(draft: PortalDraft, key: string): PortalDraft {
    return { ...draft, logo: { ...draft.logo, wideKey: key, mode: 'custom_logo' } }
  },
  /** A new icon, with its favicon. */
  setUploadedIcon(draft: PortalDraft, icon: PortalIcon): PortalDraft {
    return { ...draft, logo: { ...draft.logo, icon } }
  },
  /** The header shows the icon with the name beside it (the logo, if any, is kept). */
  showSquare(draft: PortalDraft): PortalDraft {
    if (draft.logo.mode !== 'custom_logo') return draft
    return { ...draft, logo: { ...draft.logo, mode: 'logo_and_name' } }
  },
  /** The header shows the logo the draft holds; nothing to show without one. */
  showWide(draft: PortalDraft): PortalDraft {
    if (!draft.logo.wideKey || draft.logo.mode === 'custom_logo') return draft
    return { ...draft, logo: { ...draft.logo, mode: 'custom_logo' } }
  },
  /** Removing the logo takes its dark mode version with it. */
  removeWide(draft: PortalDraft): PortalDraft {
    return {
      ...draft,
      logo: withoutNoDark({
        ...draft.logo,
        wideKey: null,
        darkKey: null,
        mode: showsWide(draft) ? 'logo_and_name' : draft.logo.mode,
      }),
    }
  },
  /** A dark mode version just uploaded: shown in the logo's place where the portal is dark. */
  setUploadedDark(draft: PortalDraft, key: string): PortalDraft {
    return { ...draft, logo: { ...draft.logo, darkKey: key } }
  },
  removeDark(draft: PortalDraft): PortalDraft {
    return draft.logo.darkKey
      ? { ...draft, logo: withoutNoDark({ ...draft.logo, darkKey: null }) }
      : draft
  },
}

/** The logo's dark mode version in a draft, or null. */
export const darkKeyOf = (draft: Pick<PortalDraft, 'logo'>) => draft.logo.darkKey ?? null

/** Whether the header shows the logo. */
export const showsWide = (draft: PortalDraft) =>
  draft.logo.mode === 'custom_logo' && draft.logo.wideKey !== null

// ============================================
// History
// ============================================

/** Steps kept for undo. */
const HISTORY_CAP = 100
/** Edits to the same control closer together than this are one step (a drag, a typing burst). */
const BURST_MS = 1000

export interface DraftHistory {
  past: PortalDraft[]
  present: PortalDraft
  future: PortalDraft[]
  /** The control the last step came from, and when, so a burst stays one step. */
  burst: { key: string; at: number } | null
}

export function startHistory(draft: PortalDraft): DraftHistory {
  return { past: [], present: draft, future: [], burst: null }
}

/**
 * The history with `next` as the present. Repeated edits to one control
 * (`burst`) within a second of each other replace the present instead of
 * adding a step, so a drag or a typed word undoes in one go.
 */
export function applyToHistory(
  history: DraftHistory,
  next: PortalDraft,
  { burst, now = Date.now() }: { burst?: string; now?: number } = {}
): DraftHistory {
  if (next === history.present) return history
  const sameBurst =
    burst !== undefined &&
    history.burst?.key === burst &&
    now - history.burst.at < BURST_MS &&
    history.past.length > 0
  return {
    past: sameBurst ? history.past : [...history.past, history.present].slice(-HISTORY_CAP),
    present: next,
    future: [],
    burst: burst === undefined ? null : { key: burst, at: now },
  }
}

export function undoHistory(history: DraftHistory): DraftHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    burst: null,
  }
}

export function redoHistory(history: DraftHistory): DraftHistory {
  const [next, ...rest] = history.future
  if (!next) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_CAP),
    present: next,
    future: rest,
    burst: null,
  }
}

// ============================================
// Changes and publish
// ============================================

const COLOUR_KEYS = [
  'primary',
  'background',
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'border',
  'header',
  ...Object.values(PICKED_KEYS),
] as const

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Whether a Help Center header link is complete enough for the portal to show. */
export function isShownHeaderLink(link: HelpCenterHeaderLink): boolean {
  const url = link.url.trim()
  return link.label.trim().length > 0 && (/^https?:\/\/\S+/i.test(url) || /^\/\S*/.test(url))
}

/** Tab rows that are drafts, not config: links with no address yet. */
const publishableNav = (nav: PortalNavItemConfig[]) =>
  nav.filter((item) => item.type !== 'link' || !!item.url)

/** Whether the theme part (stylesheet, mode, buttons) differs. */
export function themeChanged(baseline: PortalDraft, draft: PortalDraft): boolean {
  return (
    baseline.cssText !== draft.cssText ||
    baseline.themeMode !== draft.themeMode ||
    baseline.buttonShape !== draft.buttonShape ||
    baseline.cardStyle !== draft.cardStyle ||
    !same(baseline.customFont, draft.customFont) ||
    !same(baseline.customHeadingFont, draft.customHeadingFont) ||
    baseline.headingScope !== draft.headingScope
  )
}

/** The settings the draft changes against the baseline, each named once, in page order. */
export function draftChanges(baseline: PortalDraft, draft: PortalDraft): string[] {
  if (baseline === draft) return []
  const changes: string[] = []
  if (baseline.themeMode !== draft.themeMode) changes.push('Light and dark')
  if (baseline.cssText !== draft.cssText) {
    const before = palettesOf(baseline.cssText)
    const after = palettesOf(draft.cssText)
    const colours = (['light', 'dark'] as const).some((mode) =>
      COLOUR_KEYS.some((key) => before[mode][key] !== after[mode][key])
    )
    if (colours) changes.push('Colours')
  }
  if (
    (baseline.cssText !== draft.cssText && draftFont(baseline) !== draftFont(draft)) ||
    !same(baseline.customFont, draft.customFont)
  )
    changes.push('Font')
  if (
    (baseline.cssText !== draft.cssText &&
      draftHeadingFont(baseline) !== draftHeadingFont(draft)) ||
    !same(baseline.customHeadingFont, draft.customHeadingFont) ||
    baseline.headingScope !== draft.headingScope
  )
    changes.push('Headings')
  if (baseline.cardStyle !== draft.cardStyle) changes.push('Cards')
  if (baseline.cssText !== draft.cssText && draftRadius(baseline) !== draftRadius(draft))
    changes.push('Corners')
  if (baseline.buttonShape !== draft.buttonShape) changes.push('Buttons')
  if (baseline.cssText !== draft.cssText && draftRemainder(baseline) !== draftRemainder(draft)) {
    changes.push('Advanced CSS')
  }
  if (baseline.headerName.trim() !== draft.headerName.trim()) changes.push('Portal name')
  if (
    baseline.logo.wideKey !== draft.logo.wideKey ||
    baseline.logo.mode !== draft.logo.mode ||
    darkKeyOf(baseline) !== darkKeyOf(draft)
  )
    changes.push('Logo')
  if (!same(baseline.logo.icon, draft.logo.icon)) changes.push('Icon')
  if (!same(baseline.nav, draft.nav)) changes.push('Tabs')
  if (!same(baseline.welcomeBody, draft.welcomeBody)) changes.push('Welcome message')
  const [a, b] = [baseline.helpCenter, draft.helpCenter]
  if (a && b) {
    if (a.homepageTitle !== b.homepageTitle) changes.push('Help Center title')
    if (a.homepageDescription !== b.homepageDescription) changes.push('Help Center description')
    if (!same(a.headerLinks, b.headerLinks)) changes.push('Help Center links')
  }
  return changes
}

/** A tab link whose address the portal would drop, if any (the publish waits for a fix). */
export function brokenNavLink(draft: PortalDraft): PortalNavItemConfig | undefined {
  return draft.nav.find((i) => i.type === 'link' && !!i.url && !isValidNavLinkUrl(i.url))
}

/** The last import, as a publish reads it: the brand assets it brought in, and the site they came from. */
export type ImportedBrand = Pick<
  BrandImport,
  'host' | 'logo' | 'logoDark' | 'icon' | 'siteFont' | 'siteHeadingFont' | 'portalOnSite'
>

/** A commercial copied font's first file: what the draft holds while it is the imported one. */
const commercialKey = (font: BrandImport['siteFont']) =>
  font && 'licence' in font && font.licence === 'commercial' ? font.files[0]?.key : undefined

/**
 * The stored file that stands for each of an import's brand assets: a
 * confirmation holds for that file, so a later import of new files asks again.
 */
export function brandAssetKey(brand: ImportedBrand, asset: BrandAsset): string | undefined {
  switch (asset) {
    case 'logo':
      return brand.logo?.stagedKey
    case 'icon':
      return brand.icon?.key
    case 'font':
      return commercialKey(brand.siteFont)
    case 'headingFont':
      return commercialKey(brand.siteHeadingFont)
  }
}

/**
 * The imported brand assets a publish would put live: still the imported
 * ones in the draft, and not live already. Assets that are live and
 * unchanged are never in a publish, so they are never asked about again.
 */
export function carriedAssets(
  input: Omit<PublishPortalCustomisationInput, 'before'>,
  baseline: PortalDraft,
  brand: ImportedBrand
): BrandAsset[] {
  const fontKey = brandAssetKey(brand, 'font')
  const headingKey = brandAssetKey(brand, 'headingFont')
  // The theme is sent whole: a font counts only when it is new to what is live.
  const carriesFont =
    fontKey !== undefined &&
    input.theme?.customFont?.files[0]?.key === fontKey &&
    baseline.customFont?.files[0]?.key !== fontKey
  const carriesHeadingFont =
    headingKey !== undefined &&
    input.theme?.customHeadingFont?.files[0]?.key === headingKey &&
    baseline.customHeadingFont?.files[0]?.key !== headingKey
  return [
    ...((brand.logo && input.logo?.wideKey === brand.logo.stagedKey) ||
    (brand.logoDark && input.logo?.darkKey === brand.logoDark.stagedKey)
      ? ['logo' as const]
      : []),
    ...(brand.icon && input.logo?.icon?.key === brand.icon.key ? ['icon' as const] : []),
    ...(carriesFont ? ['font' as const] : []),
    ...(carriesHeadingFont ? ['headingFont' as const] : []),
  ]
}

/**
 * The import a publish carries, and what the person said of its brand
 * assets: `confirmed` names those they confirmed (or that the portal's own
 * domain vouches for), `preTicked` those of them nobody clicked to confirm.
 */
export interface PublishedImport {
  brand: ImportedBrand
  confirmed: readonly BrandAsset[]
  preTicked: readonly BrandAsset[]
}

/** The confirmation record for the brand assets this publish carries, when it carries any. */
function confirmedAssets(
  input: Omit<PublishPortalCustomisationInput, 'before'>,
  baseline: PortalDraft,
  { brand, confirmed, preTicked }: PublishedImport
): PublishPortalCustomisationInput['brandAssets'] {
  const assets = carriedAssets(input, baseline, brand).filter((asset) => confirmed.includes(asset))
  const confirmation = brandAssetsConfirmationSchema.safeParse({
    host: brand.host,
    assets,
    preTicked: assets.filter((asset) => preTicked.includes(asset)),
  })
  // The record is extra: one it cannot hold never stops the publish.
  return confirmation.success ? confirmation.data : undefined
}

/**
 * The publish for a draft: only the parts that differ from the baseline, each
 * with what the editor loaded for it as `before`. Null when nothing changed.
 * `parkCss` leaves the Advanced CSS out (the plan does not include it): the
 * stored rules stay as they are and the draft keeps its own. `brandAssets` is
 * the last import with what was confirmed of it, recorded when the publish
 * carries its logo, icon or font.
 */
export function publishInput(
  baseline: PortalDraft,
  draft: PortalDraft,
  published: PortalCustomiseValues,
  {
    parkCss = false,
    brandAssets = null,
  }: { parkCss?: boolean; brandAssets?: PublishedImport | null } = {}
): PublishPortalCustomisationInput | null {
  const before: PublishPortalCustomisationInput['before'] = {}
  const input: Omit<PublishPortalCustomisationInput, 'before'> = {}

  if (themeChanged(baseline, draft)) {
    const theme = themePublishOf(
      draft.cssText,
      draft.themeMode,
      draft.buttonShape,
      draft.customFont,
      {
        cardStyle: draft.cardStyle,
        customHeadingFont: draft.customHeadingFont,
        headingScope: draft.headingScope,
      }
    )
    before.theme = published.theme ?? null
    input.theme = theme.theme as PublishPortalCustomisationInput['theme']
    if (!parkCss) {
      before.customCss = published.customCss ?? null
      input.customCss = theme.customCss
    }
  }

  if (baseline.headerName.trim() !== draft.headerName.trim()) {
    before.headerName = published.headerName ?? null
    input.headerName = draft.headerName.trim()
  }

  const wideChanged = baseline.logo.wideKey !== draft.logo.wideKey
  const darkChanged = darkKeyOf(baseline) !== darkKeyOf(draft)
  const modeChanged = baseline.logo.mode !== draft.logo.mode
  // An icon is never removed here, only replaced by an upload, which always has its favicon.
  const newIcon: PortalIcon | null =
    draft.logo.icon?.faviconKey && !same(baseline.logo.icon, draft.logo.icon)
      ? { key: draft.logo.icon.key, faviconKey: draft.logo.icon.faviconKey }
      : null
  const iconChanged = newIcon !== null
  if (wideChanged || darkChanged || modeChanged || iconChanged) {
    before.logo = {
      ...(wideChanged ? { wideKey: published.logo?.wideKey ?? null } : {}),
      ...(darkChanged ? { darkKey: published.logo?.darkKey ?? null } : {}),
      ...(modeChanged
        ? { headerDisplayMode: published.logo?.headerDisplayMode ?? 'logo_and_name' }
        : {}),
      ...(iconChanged ? { icon: published.logo?.icon ?? null } : {}),
    }
    input.logo = {
      ...(wideChanged ? { wideKey: draft.logo.wideKey } : {}),
      ...(darkChanged ? { darkKey: darkKeyOf(draft) } : {}),
      ...(modeChanged ? { headerDisplayMode: draft.logo.mode } : {}),
      ...(newIcon ? { icon: newIcon } : {}),
    }
  }

  const navChanged = !same(baseline.nav, draft.nav)
  const welcomeChanged = !same(baseline.welcomeBody, draft.welcomeBody)
  if (navChanged || welcomeChanged) {
    before.portal = {
      ...(navChanged ? { nav: published.portal?.nav ?? null } : {}),
      ...(welcomeChanged ? { welcomeCard: published.portal?.welcomeCard ?? null } : {}),
    }
    input.portal = {
      ...(navChanged ? { nav: { items: publishableNav(draft.nav) } } : {}),
      ...(welcomeChanged ? { welcomeCard: { body: draft.welcomeBody } } : {}),
    }
  }

  const [a, b] = [baseline.helpCenter, draft.helpCenter]
  if (a && b) {
    const fields = (['homepageTitle', 'homepageDescription', 'headerLinks'] as const).filter(
      (field) => !same(a[field], b[field])
    )
    if (fields.length > 0) {
      before.helpCenter = Object.fromEntries(
        fields.map((field) => [field, published.helpCenter?.[field] ?? null])
      )
      // Link rows still being filled in are drafts, not config.
      input.helpCenter = Object.fromEntries(
        fields.map((field) => [
          field,
          field === 'headerLinks' ? b.headerLinks.filter(isShownHeaderLink) : b[field],
        ])
      )
    }
  }

  if (Object.keys(input).length === 0) return null
  const confirmation = brandAssets ? confirmedAssets(input, baseline, brandAssets) : undefined
  // The site this look was imported from, for the launch plan's "Imported from" line.
  const importedFrom = brandImportSchema.shape.host.safeParse(brandAssets?.brand.host)
  return {
    before,
    ...input,
    ...(confirmation ? { brandAssets: confirmation } : {}),
    ...(importedFrom.success ? { importedFrom: importedFrom.data } : {}),
  }
}
