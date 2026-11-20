/**
 * Ask against the editor's draft (PORTAL-CUSTOMISE-SPEC §6.8): a patch from
 * Ask applied through the same writes the sections use, and the draft as
 * Ask's request carries it. Pure; the editor applies the result as one step.
 */
import { fontIdForValue, normalizeFontSans, tryCssColorToHex } from '@/lib/shared/theme'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import {
  applyTabsPatch,
  HEADER_AUTO,
  PATCH_COLOUR_ROLES,
  welcomeDocToText,
  welcomeTextToDoc,
  type PortalDraftPatch,
} from '@/lib/shared/portal-customise/draft-patch'
import type { AskDraftContext } from '@/lib/shared/portal-customise/ask'
import { draftFont, draftPalette, draftRadius, editTheme, type PortalDraft } from './portal-draft'
import type { Palette } from '@/components/admin/settings/branding/theme-css'

/**
 * The draft with a patch applied. Colours go through the colour setters (so
 * derived colours follow), a listed font replaces an uploaded one, and the
 * Advanced CSS rules are carried over untouched. Tab ids the draft does not
 * have are ignored, Feedback stays on, and Help Center fields are skipped
 * when the draft has no Help Center home. A header colour of "auto" puts the bar
 * back on Auto.
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
        if (hex) next = editTheme.setColour(next, variable, mode, hex === HEADER_AUTO ? null : hex)
      }
    }
  }
  if (patch.font) {
    next = editTheme.setFont(next, BRANDING_FONTS.find((font) => font.id === patch.font)!.value)
  }
  if (patch.corners !== undefined) next = editTheme.setRadius(next, patch.corners)
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

/** The draft as Ask's request carries it: never Advanced CSS, logo keys or font files. */
export function summariseDraftForAsk(draft: PortalDraft): AskDraftContext {
  return {
    themeMode: draft.themeMode,
    buttonShape: draft.buttonShape,
    corners: draftRadius(draft),
    font: draft.customFont ? null : fontIdForValue(normalizeFontSans(draftFont(draft))),
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
