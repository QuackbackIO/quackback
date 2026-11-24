/**
 * Import your brand in the draft (PORTAL-CUSTOMISE-SPEC §6.1): what an import
 * changes, as one step through the writes the sections use; taking one result
 * row back; and the rows that say what was matched. Plain functions.
 *
 * Everything the site gives applies at once, its brand assets too: the
 * site's logo, its icon and a commercial font copied from it (the text's or
 * the headings'). Publish asks the person to confirm the brand owns or
 * licenses each asset it would put live (`carriedAssets` in portal-draft),
 * and `dropAsset` takes one back when they do not.
 *
 * Words are never applied: the site's name and a welcome line are offered
 * beside the rows (`importSuggestions`), each used on a click.
 */
import type {
  BrandAsset,
  BrandImport,
  BrandTokens,
  SiteFontRefusal,
} from '@/lib/shared/theme/brand-import'
import type { CustomFont } from '@/lib/shared/theme/font-uploads'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import type { TiptapContent } from '@/lib/shared/db-types'
import { editPalettes, type Palette } from '@/components/admin/settings/branding/theme-css'
import { PICKED_KEYS, type PickableKey } from '@/lib/shared/theme/base'
import { CARD_STYLE_NAMES, cornersName, fontName } from './font-shape-section'
import {
  draftFont,
  draftHeadingFont,
  draftPalette,
  draftRadius,
  editLogo,
  editHeaderName,
  shownName,
  editTheme,
  type PortalDraft,
} from './portal-draft'

export type ImportRowKey =
  'logo' | 'icon' | 'primary' | 'page' | 'font' | 'headings' | 'cards' | 'shape'

export interface ImportRow {
  key: ImportRowKey
  label: string
  /** Matched as the site has it, the nearest we have, not found, or skipped: nothing to change, so the draft's stays. */
  state: 'matched' | 'nearest' | 'missing' | 'skipped'
  text: string
  /** Colour swatches shown before the text. */
  swatches?: string[]
  /** A licensed family to offer as an upload. */
  uploadFont?: string
  /** Whether the row changed the draft, so Undo has something to take back. */
  applied: boolean
}

/** The result row each brand asset is. */
export const ASSET_ROW: Record<BrandAsset, ImportRowKey> = {
  logo: 'logo',
  icon: 'icon',
  font: 'font',
  headingFont: 'headings',
}

/** The page colours an import sets: the background and what follows it, the text and the header bar. */
const PAGE_KEYS = [
  'background',
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'border',
  'header',
] as const

/** Why the site's own font files were not copied, as the font row says it. */
const NOT_COPIED: Record<SiteFontRefusal, string> = {
  service: 'Can’t be copied.',
  restricted: 'Can’t be copied.',
  subset: 'Not copied: the site serves only part of it.',
  'too-large': 'Not copied: its files are over 400 KB.',
}

const fontValueOf = (id: string) => BRANDING_FONTS.find((font) => font.id === id)?.value

/** The site's own font as an uploaded family, the nearest listed font behind it. */
function copiedFont(brand: BrandImport): CustomFont | null {
  const font = brand.siteFont
  if (!font || 'notCopied' in font || font.files.length === 0) return null
  return { family: font.family, files: font.files, fallback: brand.font.id }
}

/** Whether the copied font is a brand asset Publish confirms: a commercial one is, an open-licence one never. */
const fontIsAsset = (brand: BrandImport) =>
  copiedFont(brand) !== null &&
  !!brand.siteFont &&
  'licence' in brand.siteFont &&
  brand.siteFont.licence === 'commercial'

/** The site's own headings family as an uploaded one, when its files were copied. */
function copiedHeadingFont(brand: BrandImport): CustomFont | null {
  const font = brand.siteHeadingFont
  if (!brand.headings || brand.headings.id) return null
  if (!font || 'notCopied' in font || font.files.length === 0) return null
  // The headings stack ends in the text font; the listed one is kept for the record.
  return { family: font.family, files: font.files, fallback: brand.font.id }
}

/** Whether the copied headings font is a brand asset, as a commercial text font is. */
const headingIsAsset = (brand: BrandImport) =>
  copiedHeadingFont(brand) !== null &&
  !!brand.siteHeadingFont &&
  'licence' in brand.siteHeadingFont &&
  brand.siteHeadingFont.licence === 'commercial'

/**
 * The draft with the import's font: the nearest listed font, and ahead of it
 * the site's own files when they were copied. A family the person uploaded
 * themselves stays when it is the site's own; any other upload goes.
 */
function withFont(draft: PortalDraft, brand: BrandImport): PortalDraft {
  const value = fontValueOf(brand.font.id)
  if (brand.missing.includes('font') || !value) return draft
  const own =
    draft.customFont && sameFamily(draft.customFont.family, brand.font.site)
      ? draft.customFont
      : undefined
  const font = own ?? copiedFont(brand)
  return font ? editTheme.setUploadedFont(draft, font, value) : editTheme.setFont(draft, value)
}

/**
 * The draft with the import's headings font: a font the portal has, or the
 * site's own files when they were copied. A family that could not be copied
 * has no substitute: the draft's headings stay as they are.
 */
function withHeadings(draft: PortalDraft, brand: BrandImport): PortalDraft {
  const listed = brand.headings?.id ? fontValueOf(brand.headings.id) : undefined
  const copied = listed ? null : copiedHeadingFont(brand)
  const next = listed
    ? editTheme.setHeadingFont(draft, listed)
    : copied
      ? editTheme.setUploadedHeadingFont(draft, copied)
      : null
  if (!next) return draft
  // A face the site draws only large is for page headings, not a post's or a card's title.
  return editTheme.setHeadingScope(next, brand.headings?.display ? 'page' : undefined)
}

/** The draft with the import's logo and icon. */
function withLogoAndIcon(draft: PortalDraft, brand: BrandImport): PortalDraft {
  let next = draft
  if (brand.logo) {
    next = editLogo.setUploadedWide(next, brand.logo.stagedKey)
    // The site's own dark-mode logo with it; a dark version of the logo this one replaces goes.
    next = brand.logoDark
      ? editLogo.setUploadedDark(next, brand.logoDark.stagedKey)
      : editLogo.removeDark(next)
  }
  if (brand.icon)
    next = editLogo.setUploadedIcon(next, {
      key: brand.icon.key,
      faviconKey: brand.icon.faviconKey,
    })
  // A square logo is a mark alone: with an icon to show, the header shows it beside the name.
  if (brand.logo?.kind === 'square' && next.logo.wideKey === brand.logo.stagedKey && next.logo.icon)
    next = editLogo.showSquare(next)
  return next
}

/** Whether the draft's uploaded font is the one this import copied. */
const holdsCopiedFont = (draft: PortalDraft, brand: BrandImport) => {
  const key = copiedFont(brand)?.files[0]?.key
  return key !== undefined && draft.customFont?.files[0]?.key === key
}

/** Whether the draft's uploaded headings font is the one this import copied. */
const holdsCopiedHeading = (draft: PortalDraft, brand: BrandImport) => {
  const key = copiedHeadingFont(brand)?.files[0]?.key
  return key !== undefined && draft.customHeadingFont?.files[0]?.key === key
}

/**
 * The draft without one of the import's brand assets: taken back to what it
 * was before the import, the way its row's Undo does, while the draft still
 * holds the imported one. Whatever the person has changed since is theirs and stays.
 */
export function dropAsset(
  draft: PortalDraft,
  before: PortalDraft,
  brand: BrandImport,
  asset: BrandAsset
): PortalDraft {
  // A logo changed by hand since, with the site's dark version still beside it: that goes alone.
  if (
    asset === 'logo' &&
    draft.logo.wideKey !== brand.logo?.stagedKey &&
    brand.logoDark &&
    draft.logo.darkKey === brand.logoDark.stagedKey
  )
    return before.logo.darkKey
      ? editLogo.setUploadedDark(draft, before.logo.darkKey)
      : editLogo.removeDark(draft)
  const holds =
    asset === 'logo'
      ? brand.logo !== undefined && draft.logo.wideKey === brand.logo.stagedKey
      : asset === 'icon'
        ? brand.icon !== undefined && draft.logo.icon?.key === brand.icon.key
        : asset === 'font'
          ? fontIsAsset(brand) && holdsCopiedFont(draft, brand)
          : headingIsAsset(brand) && holdsCopiedHeading(draft, brand)
  return holds ? takeBackRow(draft, before, brand, ASSET_ROW[asset]) : draft
}

/**
 * One import row taken back, as its Undo does. The icon's takes the imported
 * square logo back to showing alone: it went beside the name only for this icon.
 */
export function takeBackRow(
  draft: PortalDraft,
  before: PortalDraft,
  brand: BrandImport,
  key: ImportRowKey
): PortalDraft {
  const next = revertImportRow(draft, before, key)
  return key === 'icon' &&
    brand.logo?.kind === 'square' &&
    next.logo.wideKey === brand.logo.stagedKey
    ? editLogo.showWide(next)
    : next
}

/** The draft with an import applied: every value the site gave, its brand assets too, nothing else. */
export function applyBrandImport(draft: PortalDraft, brand: BrandImport): PortalDraft {
  let next = draft
  const dark = brand.scheme === 'dark'
  const side = dark ? 'dark' : 'light'
  // Each area the site gives is rebuilt from the default, never mixed into
  // what was there: the page on both sides, the mode, the main colour.
  if (brand.background) {
    next = resetPage(next)
    // The mode follows the site: always dark, always light, or the visitor's
    // choice when the site has a dark mode of its own. Never a dark mode made here.
    next = { ...next, themeMode: dark ? 'dark' : brand.darkMode ? 'user' : 'light' }
    next = editTheme.setColour(next, 'background', side, brand.background)
  }
  if (brand.text) next = editTheme.setColour(next, 'foreground', side, brand.text)
  if (brand.primary) {
    next = withoutPrimary(next)
    next = editTheme.setColour(next, 'primary', side, brand.primary)
  }
  // The site's own neutrals over the ones its page colour would give.
  if (brand.tokens) next = withTokens(next, side, brand.tokens)
  // A light site's own dark mode, for visitors who see the portal dark.
  if (brand.darkMode) {
    const { background, foreground, primary, ...tokens } = brand.darkMode
    next = editTheme.setColour(next, 'background', 'dark', background)
    if (foreground) next = editTheme.setColour(next, 'foreground', 'dark', foreground)
    if (primary) next = editTheme.setColour(next, 'primary', 'dark', primary)
    next = withTokens(next, 'dark', tokens)
  }
  next = withFont(next, brand)
  next = withHeadings(next, brand)
  if (brand.cardStyle) next = editTheme.setCardStyle(next, brand.cardStyle)
  if (brand.radius !== undefined) next = editTheme.setRadius(next, brand.radius)
  if (brand.buttonShape) next = { ...next, buttonShape: brand.buttonShape }
  return withLogoAndIcon(next, brand)
}

/** Both sides' page, text, neutrals and header back to automatic. */
function resetPage(draft: PortalDraft): PortalDraft {
  let next = draft
  for (const mode of ['light', 'dark'] as const) {
    next = editTheme.setColour(next, 'background', mode, null)
    next = editTheme.setColour(next, 'foreground', mode, null)
    next = editTheme.setColour(next, 'header', mode, null)
  }
  return next
}

/** Both sides' main colour cleared, so the dark one follows the light one set next. */
function withoutPrimary(draft: PortalDraft): PortalDraft {
  const drop = ({ primary: _primary, pickedPrimary: _picked, ...rest }: Palette) => rest
  return {
    ...draft,
    cssText: editPalettes(draft.cssText, (light, dark) => ({
      light: drop(light),
      dark: drop(dark),
    })),
  }
}

/** Whether two font family names are the same face (`Söhne` is `Sohne`). */
function sameFamily(a: string, b: string | undefined): boolean {
  const plain = (name: string) =>
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  return b !== undefined && plain(a) === plain(b)
}

/** The last import, as the editor holds it, so the next can take its place. */
export interface PreviousImport {
  brand: BrandImport
  before: PortalDraft
  undone: ImportRowKey[]
}

/**
 * A new import replaces the last one rather than stacking on it: the rows the
 * last import applied (and that were not undone) are taken back first, so
 * Nexus then Mailchimp gives what Mailchimp alone gives, and what the person
 * set themselves stays wherever the new site says nothing. `before` is that
 * draft, which the new rows' Undo returns to.
 */
export function replaceImport(
  draft: PortalDraft,
  previous: PreviousImport | null,
  brand: BrandImport
): { next: PortalDraft; before: PortalDraft } {
  const before = previous ? revertImport(draft, previous) : draft
  return { before, next: applyBrandImport(before, brand) }
}

/** The parts of a draft an import row can change, to tell whether taking one back changes anything. */
const lookOf = (draft: PortalDraft) =>
  JSON.stringify([
    draft.cssText,
    draft.themeMode,
    draft.buttonShape,
    draft.cardStyle,
    draft.customFont ?? null,
    draft.customHeadingFont ?? null,
    draft.headingScope ?? null,
    draft.logo,
  ])

/**
 * The rows taken back that are still taken back, read from the draft: a row
 * the editor's undo brought back (taking it back again would change the
 * draft) is in it again, whatever `undone` remembers.
 */
export function stillUndone(
  draft: PortalDraft,
  before: PortalDraft,
  undone: readonly ImportRowKey[]
): ImportRowKey[] {
  const now = lookOf(draft)
  return undone.filter((key) => lookOf(revertImportRow(draft, before, key)) === now)
}

/** Whether a row's value is in the draft now: applied, and not taken back since. */
export function stillApplied(row: ImportRow, undone: readonly ImportRowKey[]): boolean {
  return row.applied && !undone.includes(row.key)
}

/**
 * The draft with everything an import applied (and that was not taken back
 * since) taken back, to what it was before the import.
 */
export function revertImport(draft: PortalDraft, previous: PreviousImport): PortalDraft {
  let next = draft
  for (const row of importRows(previous.brand))
    if (stillApplied(row, previous.undone)) next = revertImportRow(next, previous.before, row.key)
  return next
}

/** The draft with `tokens` written on one side's palette. */
function withTokens(draft: PortalDraft, side: 'light' | 'dark', tokens: BrandTokens): PortalDraft {
  const set = Object.fromEntries(Object.entries(tokens).filter(([, v]) => v !== undefined))
  if (Object.keys(set).length === 0) return draft
  // The site's colours are the ones picked: any kept beside them goes.
  const apply = (palette: Palette): Palette => {
    const out: Palette = { ...palette, ...set }
    for (const key of Object.keys(set))
      if (key in PICKED_KEYS) delete out[PICKED_KEYS[key as PickableKey]]
    return out
  }
  const cssText = editPalettes(draft.cssText, (light, dark) =>
    side === 'light' ? { light: apply(light), dark } : { light, dark: apply(dark) }
  )
  return { ...draft, cssText }
}

/** `palette` with `keys` as they are in `from`, with the colours kept as picked for them. */
function restoreKeys(palette: Palette, from: Palette, keys: readonly (keyof Palette)[]): Palette {
  const out: Palette = { ...palette }
  const picked = keys.flatMap((key) =>
    key in PICKED_KEYS ? [PICKED_KEYS[key as PickableKey]] : []
  )
  for (const key of [...keys, ...picked]) {
    if (from[key] === undefined) delete out[key]
    else out[key] = from[key]
  }
  return out
}

/** `draft` with one import row's values as they were in `before`. */
export function revertImportRow(
  draft: PortalDraft,
  before: PortalDraft,
  key: ImportRowKey
): PortalDraft {
  const palettes = (keys: readonly (keyof Palette)[]) =>
    editPalettes(draft.cssText, (light, dark) => ({
      light: restoreKeys(light, draftPalette(before, 'light'), keys),
      dark: restoreKeys(dark, draftPalette(before, 'dark'), keys),
    }))
  switch (key) {
    case 'logo':
      return {
        ...draft,
        logo: {
          ...(({ darkKey: _imported, ...logo }) => logo)(draft.logo),
          wideKey: before.logo.wideKey,
          mode: before.logo.mode,
          ...(before.logo.darkKey ? { darkKey: before.logo.darkKey } : {}),
        },
      }
    case 'icon':
      return { ...draft, logo: { ...draft.logo, icon: before.logo.icon } }
    case 'primary':
      return { ...draft, cssText: palettes(['primary']) }
    case 'page':
      return { ...draft, themeMode: before.themeMode, cssText: palettes(PAGE_KEYS) }
    case 'font': {
      const next = editTheme.setFont(draft, draftFont(before))
      return before.customFont ? { ...next, customFont: before.customFont } : next
    }
    case 'headings': {
      const font = editTheme.setHeadingFont(draft, draftHeadingFont(before))
      const next = editTheme.setHeadingScope(font, before.headingScope)
      return before.customHeadingFont
        ? { ...next, customHeadingFont: before.customHeadingFont }
        : next
    }
    case 'cards':
      return editTheme.setCardStyle(draft, before.cardStyle)
    case 'shape':
      return { ...editTheme.setRadius(draft, draftRadius(before)), buttonShape: before.buttonShape }
  }
}

/** The result rows of an import, in the order the section lists them. */
export function importRows(
  brand: BrandImport,
  /** What the draft already had before the import, which stays where the site has none. */
  kept: { logo: boolean; icon: boolean } = { logo: false, icon: false }
): ImportRow[] {
  const rows: ImportRow[] = []

  rows.push(
    brand.logo
      ? {
          key: 'logo',
          label: 'Logo',
          state: 'matched',
          text: brand.logoDark ? 'With its dark mode version' : 'From the site',
          applied: true,
        }
      : {
          key: 'logo',
          label: 'Logo',
          state: 'missing',
          text: kept.logo ? 'Not found. Your logo stays.' : 'Not found on the site.',
          applied: false,
        }
  )

  rows.push(
    brand.icon
      ? {
          key: 'icon',
          label: 'Icon',
          state: 'matched',
          text: 'The site’s app icon',
          applied: true,
        }
      : {
          key: 'icon',
          label: 'Icon',
          state: 'missing',
          text: brand.iconBlocked
            ? 'Only an owner can change the icon.'
            : kept.icon
              ? 'None found. Your icon stays.'
              : 'No square icon of 120 px or more.',
          applied: false,
        }
  )

  rows.push(
    brand.primary
      ? {
          key: 'primary',
          label: 'Main colour',
          state: 'matched',
          text: brand.primary,
          swatches: [brand.primary],
          applied: true,
        }
      : {
          key: 'primary',
          label: 'Main colour',
          state: 'missing',
          text: 'No main colour found.',
          applied: false,
        }
  )

  const page = [brand.background, brand.text].filter((c): c is NonNullable<typeof c> => !!c)
  const neutrals = [
    brand.tokens?.header,
    brand.tokens?.card,
    brand.tokens?.border,
    brand.tokens?.mutedForeground,
  ]
  const palette = [...page, ...neutrals, brand.darkMode?.background].filter(
    (c): c is NonNullable<typeof c> => !!c
  )
  // The mode follows the site, and the row says which way it went; its swatches show the colours.
  const mode = !brand.background
    ? page.join(' · ')
    : brand.scheme === 'dark'
      ? 'Always dark'
      : brand.darkMode
        ? 'Light and dark'
        : 'Always light'
  rows.push(
    page.length > 0
      ? {
          key: 'page',
          label: 'Page and text',
          state: 'matched',
          text: mode,
          swatches: palette,
          applied: true,
        }
      : {
          key: 'page',
          label: 'Page and text',
          state: 'missing',
          text: 'No page colours found.',
          applied: false,
        }
  )

  const value = fontValueOf(brand.font.id)
  const name = value ? fontName(value) : brand.font.id
  if (brand.missing.includes('font') || !value) {
    rows.push({
      key: 'font',
      label: 'Text font',
      state: 'missing',
      text: 'No font found.',
      applied: false,
    })
  } else if (copiedFont(brand) && brand.siteFont) {
    rows.push({
      key: 'font',
      label: 'Text font',
      state: 'matched',
      text: `${brand.siteFont.family}, from the site`,
      applied: true,
    })
  } else if (brand.siteFont && 'notCopied' in brand.siteFont) {
    rows.push({
      key: 'font',
      label: 'Text font',
      state: 'nearest',
      text: `${NOT_COPIED[brand.siteFont.notCopied]} ${name} stands in.`,
      uploadFont: brand.font.site ?? brand.siteFont.family,
      applied: true,
    })
  } else if (brand.font.exact || !brand.font.site) {
    rows.push({
      key: 'font',
      label: 'Text font',
      state: brand.font.exact ? 'matched' : 'nearest',
      text: brand.font.exact ? `${name}, same as the site` : `${name}, the nearest we have`,
      applied: true,
    })
  } else {
    rows.push({
      key: 'font',
      label: 'Text font',
      state: 'nearest',
      // No file of it was read, so nothing is known of its licence: only that the portal lacks it.
      text: `${brand.font.site} isn’t one we have, so ${name} stands in.`,
      uploadFont: brand.font.site,
      applied: true,
    })
  }

  rows.push(headingsRow(brand), cardsRow(brand))

  if (brand.radius === undefined && !brand.buttonShape) {
    rows.push({
      key: 'shape',
      label: 'Shape',
      state: 'missing',
      text: 'No shape found.',
      applied: false,
    })
  } else {
    const text =
      brand.buttonShape === 'corners' && brand.buttonPx !== undefined
        ? `Buttons with ${brand.buttonPx}px corners`
        : `${brand.radius !== undefined ? cornersName(brand.radius) : 'Soft'} corners, ${brand.buttonShape === 'corners' ? 'matching buttons' : 'pill buttons'}`
    rows.push({ key: 'shape', label: 'Shape', state: 'matched', text, applied: true })
  }

  return rows
}

/** What the Headings row says in place of a family it could not copy: there is no nearest substitute. */
const HEADINGS_MATCH_TEXT = 'They match the text font.'

/** The Headings row: the font set, or why the headings stay as they are. */
function headingsRow(brand: BrandImport): ImportRow {
  const row = { key: 'headings', label: 'Headings' } as const
  const headings = brand.headings
  if (!headings) return { ...row, state: 'skipped', text: 'Same as the text font.', applied: false }
  const listed = headings.id ? fontValueOf(headings.id) : undefined
  // A face the site draws only large goes on page headings alone.
  const where = headings.display ? 'on page headings' : null
  if (listed)
    return {
      ...row,
      state: 'matched',
      text: `${fontName(listed)}, ${where ?? 'same as the site'}`,
      applied: true,
    }
  const copied = copiedHeadingFont(brand)
  if (copied)
    return {
      ...row,
      state: 'matched',
      text: `${copied.family}, ${where ?? 'from the site'}`,
      applied: true,
    }
  const font = brand.siteHeadingFont
  // Not copied for a reason the read gave, or no file of it was read at all.
  const why =
    font && 'notCopied' in font ? NOT_COPIED[font.notCopied] : `${headings.site} isn’t one we have.`
  return { ...row, state: 'skipped', text: `${why} ${HEADINGS_MATCH_TEXT}`, applied: false }
}

/** The Cards row: the style the site's cards clearly share, or that the draft's stays. */
function cardsRow(brand: BrandImport): ImportRow {
  return brand.cardStyle
    ? {
        key: 'cards',
        label: 'Cards',
        state: 'matched',
        text: `${CARD_STYLE_NAMES[brand.cardStyle]}, like the site`,
        applied: true,
      }
    : {
        key: 'cards',
        label: 'Cards',
        state: 'skipped',
        text: 'No clear style found. Yours stays.',
        applied: false,
      }
}

// ============================================
// Suggested words
// ============================================

export type SuggestionKey = 'name' | 'welcome'

export interface ImportSuggestion {
  key: SuggestionKey
  label: string
  /** What is offered, and for the name, what it would replace. */
  text: string
  /** The draft has it: read from the draft, so an undo offers it again. */
  used: boolean
}

/**
 * The welcome line Import suggests: about the feedback board, with the
 * brand's name, never the site's own tagline. English only: the workspace
 * has no main language setting to write it in another.
 */
export const welcomeLine = (name: string) => `Tell us what would make ${name} better for your team.`

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A message's words, paragraph by paragraph. */
function paragraphsOf(body: TiptapContent): string[] {
  const text = (node: { text?: unknown; content?: unknown }): string =>
    typeof node.text === 'string'
      ? node.text
      : Array.isArray(node.content)
        ? node.content.map((child) => text(child as { text?: unknown; content?: unknown })).join('')
        : ''
  return (body.content ?? [])
    .filter((node) => node.type === 'paragraph')
    .map((node) => text(node).trim())
}

/** The welcome message with `line` as its first paragraph; a heading above it stays. */
function withWelcomeLine(body: TiptapContent, line: string): TiptapContent {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: line }] }
  const content = [...(body.content ?? [])]
  const first = content.findIndex((node) => node.type === 'paragraph')
  if (first === -1) content.push(paragraph)
  else content[first] = paragraph
  return { ...body, type: 'doc', content } as TiptapContent
}

/** The name an import suggests for the portal's header, when it read one. */
const suggestedName = (brand: BrandImport) => brand.siteName ?? null

/**
 * The words an import suggests, each used only on a click: the site's name
 * for the portal's header when it does not show it already (the workspace
 * keeps its own name), and a welcome line with the
 * brand's name. `before` is the draft as the import found it, which decides
 * what is worth offering; `draft` says which are in use now.
 */
export function importSuggestions(
  brand: BrandImport,
  before: PortalDraft,
  draft: PortalDraft
): ImportSuggestion[] {
  const out: ImportSuggestion[] = []
  const name = suggestedName(brand)
  if (name && !sameName(name, shownName(before))) {
    const used = sameName(name, shownName(draft))
    out.push({
      key: 'name',
      label: 'Portal name',
      text: used || !shownName(draft) ? name : `${name}, now ${shownName(draft)}`,
      used,
    })
  }
  const brandName = (brand.siteName ?? shownName(before)).trim()
  if (brandName) {
    const line = welcomeLine(brandName)
    if (paragraphsOf(before.welcomeBody)[0] !== line)
      out.push({
        key: 'welcome',
        label: 'Welcome line',
        text: line,
        used: paragraphsOf(draft.welcomeBody)[0] === line,
      })
  }
  return out
}

/** The draft with one suggestion used. */
export function applySuggestion(
  draft: PortalDraft,
  brand: BrandImport,
  key: SuggestionKey
): PortalDraft {
  if (key === 'name') {
    const name = suggestedName(brand)
    return name ? editHeaderName(draft, name) : draft
  }
  const brandName = (brand.siteName ?? shownName(draft)).trim()
  if (!brandName) return draft
  return { ...draft, welcomeBody: withWelcomeLine(draft.welcomeBody, welcomeLine(brandName)) }
}

/** The colours an import read, offered first in the colour picker. */
export function siteColoursOf(brand: BrandImport | null): string[] {
  if (!brand) return []
  return [
    ...new Set(
      [
        brand.primary,
        brand.background,
        brand.text,
        brand.tokens?.header,
        brand.tokens?.card,
        brand.tokens?.border,
        brand.tokens?.mutedForeground,
        brand.darkMode?.background,
        brand.darkMode?.primary,
      ].filter((c): c is NonNullable<typeof c> => !!c)
    ),
  ]
}
