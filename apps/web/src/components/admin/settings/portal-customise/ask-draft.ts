/**
 * Ask against the editor's draft (PORTAL-CUSTOMISE-SPEC §6.8): a patch from
 * Ask applied through the same writes the sections use, and the draft as
 * Ask's request carries it. Pure; the editor applies the result as one step.
 */
import { fontIdForValue, normalizeFontSans, tryCssColorToHex } from '@/lib/shared/theme'
import { BRANDING_FONTS, type BrandingFontId } from '@/lib/shared/theme/fonts'
import {
  applyTabsPatch,
  COLOUR_AUTO,
  PATCH_COLOUR_ROLES,
  SAME_AS_TEXT_FONT,
  welcomeDocToText,
  welcomeTextToDoc,
  type PortalDraftPatch,
} from '@/lib/shared/portal-customise/draft-patch'
import type { AskDraftContext } from '@/lib/shared/portal-customise/ask'
import {
  draftFont,
  draftHeadingFont,
  draftPalette,
  draftRadius,
  editHeaderName,
  editLogo,
  editTheme,
  shownName,
  showsWide,
  type PortalDraft,
} from './portal-draft'
import type { Palette } from '@/components/admin/settings/branding/theme-css'

/**
 * The draft with a patch applied. Colours go through the colour setters (so
 * derived colours follow), a listed font replaces an uploaded one, and the
 * Advanced CSS rules are carried over untouched. Tab ids the draft does not
 * have are ignored, Feedback stays on, and Help Center fields are skipped
 * when the draft has no Help Center home. A colour of "auto" puts it back on
 * Auto. An empty portal name, or the workspace's own, puts the workspace's
 * name back; showing the logo needs one uploaded.
 */
export function applyDraftPatch(draft: PortalDraft, patch: PortalDraftPatch): PortalDraft {
  let next = draft
  if (patch.themeMode) next = { ...next, themeMode: patch.themeMode }
  if (patch.buttonShape) next = { ...next, buttonShape: patch.buttonShape }
  if (patch.colours) {
    for (const mode of ['light', 'dark'] as const) {
      const colours = patch.colours[mode]
      if (!colours) continue
      for (const [role, variable] of PATCH_COLOUR_ROLES) {
        const hex = colours[role]
        if (hex) next = editTheme.setColour(next, variable, mode, hex === COLOUR_AUTO ? null : hex)
      }
    }
  }
  if (patch.font) {
    next = editTheme.setFont(next, BRANDING_FONTS.find((font) => font.id === patch.font)!.value)
  }
  if (patch.headingFont) {
    next = editTheme.setHeadingFont(
      next,
      patch.headingFont === SAME_AS_TEXT_FONT
        ? null
        : BRANDING_FONTS.find((font) => font.id === patch.headingFont)!.value
    )
  }
  if (patch.cardStyle) next = editTheme.setCardStyle(next, patch.cardStyle)
  if (patch.corners !== undefined) next = editTheme.setRadius(next, patch.corners)
  if (patch.portalName !== undefined) {
    const name = patch.portalName.trim()
    next = editHeaderName(next, name === next.workspaceName ? '' : name)
  }
  if (patch.headerShows) {
    next = patch.headerShows === 'logo' ? editLogo.showWide(next) : editLogo.showSquare(next)
  }
  if (patch.tabs) next = { ...next, nav: applyTabsPatch(next.nav, patch.tabs) }
  if (patch.welcomeMessage !== undefined) {
    next = { ...next, welcomeBody: welcomeTextToDoc(patch.welcomeMessage) }
  }
  if (patch.helpCenter && next.helpCenter) {
    next = { ...next, helpCenter: { ...next.helpCenter, ...patch.helpCenter } }
  }
  return next
}

function coloursOf(palette: Palette): AskDraftContext['colours']['light'] {
  const out: AskDraftContext['colours']['light'] = {}
  for (const [key, variable] of [
    ['main', 'primary'],
    ['background', 'background'],
    ['text', 'foreground'],
    // Only a header colour of its own: unset, the header is the page.
    ['header', 'header'],
  ] as const) {
    const value = palette[variable]
    const hex = value ? tryCssColorToHex(value) : null
    if (hex) out[key] = hex
  }
  return out
}

/** A stack's families, unquoted and lower case. */
const familiesOf = (stack: string) =>
  stack
    .split(',')
    .map((family) =>
      family
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase()
    )
    .filter(Boolean)

/** Generic families every stack ends in: they name no font of their own. */
const GENERIC = new Set([
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  '-apple-system',
])

/**
 * The listed font a draft's stack is, by its first family when the stack is
 * not one the list has word for word (a saved `"Inter", ui-sans-serif, …`
 * is Inter, whose listed stack starts with `"Inter Variable"`). Null for a
 * font the list does not have: Ask then never sees a gap to fill.
 */
function listedFontId(stack: string): BrandingFontId | null {
  const value = normalizeFontSans(stack)
  const exact = fontIdForValue(value)
  if (exact) return exact
  const first = familiesOf(value)[0]
  if (!first || GENERIC.has(first)) return fontIdForValue(value)
  const match = BRANDING_FONTS.find((font) =>
    familiesOf(font.value).some((family) => !GENERIC.has(family) && family === first)
  )
  return match?.id ?? null
}

/** The headings font as Ask sees it: listed, the text font, or null for one of its own. */
function headingFontOf(draft: PortalDraft): AskDraftContext['headingFont'] {
  if (draft.customHeadingFont) return null
  const stack = draftHeadingFont(draft)
  return stack ? listedFontId(stack) : SAME_AS_TEXT_FONT
}

/** The draft as Ask's request carries it: never Advanced CSS, logo keys or font files. */
export function summariseDraftForAsk(draft: PortalDraft): AskDraftContext {
  return {
    themeMode: draft.themeMode,
    buttonShape: draft.buttonShape,
    corners: draftRadius(draft),
    font: draft.customFont ? null : listedFontId(draftFont(draft)),
    headingFont: headingFontOf(draft),
    cardStyle: draft.cardStyle,
    portalName: shownName(draft).slice(0, 100),
    workspaceName: draft.workspaceName.slice(0, 100),
    headerShows: showsWide(draft) ? 'logo' : 'icon_and_name',
    hasLogo: draft.logo.wideKey !== null,
    colours: {
      light: coloursOf(draftPalette(draft, 'light')),
      dark: coloursOf(draftPalette(draft, 'dark')),
    },
    tabs: draft.nav.slice(0, 20).map((item) => ({
      id: item.id,
      type: item.type,
      ...(item.label ? { label: item.label.slice(0, 30) } : {}),
      enabled: item.enabled !== false,
    })),
    welcomeMessage: welcomeDocToText(draft.welcomeBody).slice(0, 2000),
    helpCenter: draft.helpCenter
      ? {
          homepageTitle: draft.helpCenter.homepageTitle,
          homepageDescription: draft.helpCenter.homepageDescription,
          headerLinks: draft.helpCenter.headerLinks,
        }
      : null,
  }
}
