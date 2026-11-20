/**
 * What one change did to the draft, in plain words. The chat's reply and the
 * preview's outlines both come from this comparison of the draft before and
 * after a change, so they say what happened, never what a model said it did.
 */
import { expandTheme, tryCssColorToHex } from '@/lib/shared/theme'
import { type ColourMode, type ColourRole } from '@/lib/shared/theme/colour-setters'
import { luminance } from '@/lib/shared/theme/colour-setters'
import type { PreviewEditTarget } from '@/components/public/preview-draft-context'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'
import { tabDisplayName } from '@/lib/shared/portal-customise/ask'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { colourName } from './colour-name'
import {
  draftFontName,
  draftHeadingName,
  draftPalette,
  draftRadius,
  SAME_AS_TEXT,
  darkKeyOf,
  shownName,
  type PortalDraft,
} from './portal-draft'

export interface ChangeLine {
  text: string
  /** A colour to show beside the line, as hex. */
  swatch?: string
  /** A line about corners shows that shape as an outline, never a colour. */
  swatchShape?: 'square' | 'round' | 'pill'
  /** The part of the preview the change shows on; none for a change that is everywhere. */
  target?: PreviewEditTarget
}

export interface ChangeSummary {
  /** Each setting that changed, in page order. */
  lines: ChangeLine[]
  /** What the editor changed on its own to keep the result readable. */
  adjustments: string[]
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
const hexOf = (colour: string | undefined) => (colour ? tryCssColorToHex(colour) : null)
const nameOf = (hex: string) => colourName(hex) ?? hex

/** The colours a reply names; the header last, as the Colours section lists them. */
const COLOURS: ReadonlyArray<{ role: ColourRole; label: string; target?: PreviewEditTarget }> = [
  { role: 'primary', label: 'Main colour', target: 'colours' },
  { role: 'background', label: 'Background' },
  { role: 'foreground', label: 'Text' },
  { role: 'header', label: 'Header', target: 'header' },
]

/** The sides a portal shows: one when it is light or dark only. */
function sidesOf(draft: PortalDraft): ColourMode[] {
  return draft.themeMode === 'user' ? ['light', 'dark'] : [draft.themeMode]
}

function colourLines(before: PortalDraft, after: PortalDraft): ChangeLine[] {
  if (before.cssText === after.cssText) return []
  const sides = sidesOf(after)
  const lines: ChangeLine[] = []
  for (const { role, label, target } of COLOURS) {
    const now = sides.map((side) => ({
      side,
      was: hexOf(draftPalette(before, side)[role]),
      hex: hexOf(draftPalette(after, side)[role]),
    }))
    const changed = now.filter(({ was, hex }) => was !== hex)
    if (changed.length === 0) continue
    // One line when every side the portal shows took the same colour.
    const together =
      changed.length === sides.length && changed.every((c) => c.hex === changed[0]!.hex)
    for (const { side, hex } of together ? changed.slice(0, 1) : changed) {
      const where = together ? '' : ` in ${side} mode`
      lines.push({
        // Only the header has no colour of its own: it is the page's then.
        text: hex
          ? `${label} is now ${nameOf(hex)}${where}`
          : `${label} matches the page again${where}`,
        ...(hex ? { swatch: hex } : {}),
        ...(target ? { target } : {}),
      })
    }
  }
  return lines
}

/** The corner radius in the reply's words. */
function cornersWords(rem: number): string {
  if (rem === 0) return 'square'
  if (rem <= 0.25) return 'slightly rounded'
  if (rem <= 0.5) return 'softly rounded'
  return 'round'
}

const THEME_MODE_LINES = {
  user: 'Visitors can now choose light or dark',
  light: 'The portal is now light only',
  dark: 'The portal is now dark only',
} as const

const CARD_STYLE_LINES = {
  border: 'Cards have a border again',
  shadow: 'Cards now have a shadow',
  flat: 'Cards are now flat',
} as const

const shown = (nav: PortalNavItemConfig[]) => nav.filter((item) => item.enabled !== false)

function tabLines(before: PortalNavItemConfig[], after: PortalNavItemConfig[]): string[] {
  if (same(before, after)) return []
  const lines: string[] = []
  const was = new Map(before.map((item) => [item.id, item]))
  const ids = new Set(after.map((item) => item.id))
  for (const item of after) {
    const old = was.get(item.id)
    if (!old) {
      lines.push(`${tabDisplayName(item)} tab added`)
      continue
    }
    if (tabDisplayName(old) !== tabDisplayName(item)) {
      lines.push(`${tabDisplayName(old)} is now called ${tabDisplayName(item)}`)
    }
    if ((old.enabled !== false) !== (item.enabled !== false)) {
      lines.push(`${tabDisplayName(item)} is now ${item.enabled !== false ? 'shown' : 'hidden'}`)
    }
  }
  for (const item of before)
    if (!ids.has(item.id)) lines.push(`${tabDisplayName(item)} tab removed`)

  // The order of the tabs that show both before and after.
  const order = shown(after).filter(
    (item) => was.get(item.id)?.enabled !== false && was.has(item.id)
  )
  const orderIds = new Set(order.map((item) => item.id))
  const oldOrder = shown(before).filter((item) => orderIds.has(item.id))
  if (order.some((item, i) => item.id !== oldOrder[i]?.id)) {
    const [first, last] = [order[0]!, order.at(-1)!]
    if (first.id !== oldOrder[0]!.id) lines.push(`${tabDisplayName(first)} is now first`)
    else if (last.id !== oldOrder.at(-1)!.id) lines.push(`${tabDisplayName(last)} is now last`)
    else lines.push('Tabs are in a new order')
  }
  // A change the words above do not cover (a link's address, say).
  return lines.length > 0 ? lines : ['Tabs updated']
}

/**
 * What the header bar's own colour made the editor change: the bar's text
 * and tabs, and the main button when it is turned over to stay visible.
 */
function headerAdjustments(before: PortalDraft, after: PortalDraft): string[] {
  if (before.cssText === after.cssText) return []
  const out = new Set<string>()
  for (const side of sidesOf(after)) {
    const now = expandTheme(draftPalette(after, side), { mode: side })
    const header = hexOf(now.header)
    if (!header) continue
    const was = expandTheme(draftPalette(before, side), { mode: side })
    const text = hexOf(now.headerForeground)
    const textChanged = text !== hexOf(was.headerForeground ?? was.foreground)
    const word = text && luminance(text) < 0.2 ? 'dark' : 'white'
    if (textChanged) {
      out.add(`The header's text and tabs are now ${word} so they read on ${nameOf(header)}.`)
    }
    // Turned over: the bar's text is the button's fill, in place of the main colour.
    const turned = hexOf(now.headerPrimary) !== hexOf(now.primary)
    const wasTurned = !!hexOf(was.header) && hexOf(was.headerPrimary) !== hexOf(was.primary)
    if (turned && !wasTurned) {
      out.add(`The header's button is now ${word}${textChanged ? ' too,' : ''} so it stands out.`)
    }
  }
  return [...out]
}

/** What changed between two drafts, and what the editor adjusted because of it. */
export function summariseChange(before: PortalDraft, after: PortalDraft): ChangeSummary {
  if (before === after) return { lines: [], adjustments: [] }
  const lines: ChangeLine[] = []
  if (before.themeMode !== after.themeMode) lines.push({ text: THEME_MODE_LINES[after.themeMode] })
  lines.push(...colourLines(before, after))
  if (draftFontName(before) !== draftFontName(after)) {
    lines.push({ text: `Font is now ${draftFontName(after)}` })
  }
  // A font is everywhere: the reply says it, and no one part is outlined.
  const headings = draftHeadingName(after)
  if (draftHeadingName(before) !== headings) {
    lines.push({
      text:
        headings === SAME_AS_TEXT
          ? 'Headings match the text font again'
          : `Headings are now set in ${headings}`,
    })
  }
  if (before.cardStyle !== after.cardStyle) {
    lines.push({ text: CARD_STYLE_LINES[after.cardStyle], target: 'type' })
  }

  const radius = draftRadius(after)
  const corners = cornersWords(radius)
  const cornersMoved = draftRadius(before) !== radius
  const buttonsMoved = before.buttonShape !== after.buttonShape
  const pill = after.buttonShape === 'pill'
  const shape: ChangeLine['swatchShape'] = radius === 0 ? 'square' : 'round'
  // Asked together ("square buttons"), corners and buttons read as one change.
  if (cornersMoved && buttonsMoved && !pill) {
    lines.push({
      text: `Corners and buttons are now ${corners}`,
      swatchShape: shape,
      target: 'colours',
    })
  } else {
    if (cornersMoved)
      lines.push({ text: `Corners are now ${corners}`, swatchShape: shape, target: 'colours' })
    if (buttonsMoved)
      lines.push({
        text: pill ? 'Buttons are now pill shaped' : `Buttons have ${corners} corners`,
        swatchShape: pill ? 'pill' : shape,
        target: 'colours',
      })
  }

  if (shownName(before) !== shownName(after)) {
    lines.push({ text: `Portal name is now ${shownName(after)}`, target: 'logo' })
  }
  if (before.logo.wideKey !== after.logo.wideKey || before.logo.mode !== after.logo.mode) {
    lines.push({ text: 'Logo updated', target: 'logo' })
  } else if (darkKeyOf(before) !== darkKeyOf(after)) {
    lines.push({
      text: darkKeyOf(after) ? 'Dark mode logo added' : 'Dark mode logo removed',
      target: 'logo',
    })
  }
  if (!same(before.logo.icon, after.logo.icon)) lines.push({ text: 'Icon updated', target: 'logo' })
  for (const text of tabLines(before.nav, after.nav)) lines.push({ text, target: 'nav' })
  if (!same(before.welcomeBody, after.welcomeBody)) {
    lines.push({
      text: isEmptyTiptapDoc(after.welcomeBody)
        ? 'Welcome message is now hidden'
        : 'Welcome message updated',
      target: 'welcome',
    })
  }
  const [a, b] = [before.helpCenter, after.helpCenter]
  if (a && b) {
    if (a.homepageTitle !== b.homepageTitle) {
      lines.push({ text: `Help Center title is now “${b.homepageTitle}”`, target: 'hc-home' })
    }
    if (a.homepageDescription !== b.homepageDescription) {
      lines.push({ text: 'Help Center description updated', target: 'hc-home' })
    }
    if (!same(a.headerLinks, b.headerLinks)) {
      lines.push({ text: 'Help Center links updated', target: 'hc-home' })
    }
  }
  return { lines, adjustments: headerAdjustments(before, after) }
}

/** The most areas the preview outlines for one change. */
export const MAX_FLASH_TARGETS = 3

/**
 * The parts of the preview to outline for a change, each once. None when
 * more than three would show: outlines everywhere point at nothing.
 */
export function flashTargets(summary: ChangeSummary): PreviewEditTarget[] {
  const targets = [...new Set(summary.lines.flatMap((line) => (line.target ? [line.target] : [])))]
  return targets.length > MAX_FLASH_TARGETS ? [] : targets
}
