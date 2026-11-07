/**
 * Moving a portal with its own CSS onto the design engine, and back.
 *
 * Such a portal stays on its old theme until a person switches. The switch
 * publishes today's branding converted, with the portal's CSS carried over
 * unchanged into the design's CSS, where it renders in the tenant layer. The
 * design sets the portal's theme variables itself, so the ones the CSS sets on
 * `:root` and `.dark` are read into the branding first and become design
 * fields where the converter has one. The old theme's settings stay untouched,
 * so switching back takes the design off the portal and the old theme shows as
 * it did.
 */
import { config } from '@/lib/server/config'
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import {
  CARRIED_THEME_VARIABLES,
  carriesThemeVariable,
  convertLegacyBranding,
} from '@/lib/shared/design/convert'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalDesignView } from '@/lib/shared/design/view'
import { extractCssVariables } from '@/lib/shared/theme/css-parser'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { lintDesignCss, type CssIssue } from './css-lint'
import { refusable, type DesignRefusal } from './design.actions'
import {
  getDesignState,
  publishSwitchedDesign,
  unpublishDesign,
  type DesignAuthor,
} from './design.service'
import { advancedCssRemainder, legacyBrandingOf, portalDesignView } from './engine'

export interface DesignSwitchReport {
  /** Refused CSS, which blocks the switch until it is fixed. */
  errors: CssIssue[]
  /** CSS that still works after switching but may break later, or stops applying. */
  warnings: CssIssue[]
  /** Theme variables the CSS sets that become design fields. */
  carried: CssIssue[]
}

export interface DesignSwitch {
  /** The portal can switch: the engine is on, it has CSS of its own and no published design. */
  available: boolean
  /** It switched and can go back: a design is published over CSS the old theme kept. */
  canSwitchBack: boolean
  report: DesignSwitchReport
}

/** Every theme variable, by its name in the theme settings. */
const THEME_VARIABLES = new Set<string>(
  Object.keys({
    background: 1,
    foreground: 1,
    card: 1,
    cardForeground: 1,
    popover: 1,
    popoverForeground: 1,
    primary: 1,
    primaryForeground: 1,
    secondary: 1,
    secondaryForeground: 1,
    muted: 1,
    mutedForeground: 1,
    accent: 1,
    accentForeground: 1,
    accentInk: 1,
    destructive: 1,
    destructiveForeground: 1,
    border: 1,
    input: 1,
    ring: 1,
    success: 1,
    chart1: 1,
    chart2: 1,
    chart3: 1,
    chart4: 1,
    chart5: 1,
    fontSans: 1,
    radius: 1,
    shadow2xs: 1,
    shadowXs: 1,
    shadowSm: 1,
    shadow: 1,
    shadowMd: 1,
    shadowLg: 1,
    shadowXl: 1,
    shadow2xl: 1,
  } satisfies Record<keyof ThemeVariables, 1>)
)

/** `--muted-foreground` as `mutedForeground`, if it is a theme variable. */
function themeVariable(property: string): keyof ThemeVariables | null {
  const name = property.slice(2).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  return THEME_VARIABLES.has(name) ? (name as keyof ThemeVariables) : null
}

/** The theme variables the CSS sets, per mode, with what becomes of each. */
function cssThemeVariables(css: string) {
  const found = extractCssVariables(css)
  const vars = { light: {} as ThemeVariables, dark: {} as ThemeVariables }
  const carried: CssIssue[] = []
  const lost: CssIssue[] = []
  for (const mode of ['light', 'dark'] as const) {
    const where = mode === 'light' ? ':root' : '.dark'
    for (const [property, value] of Object.entries(found[mode])) {
      const name = themeVariable(property)
      if (!name) continue
      vars[mode][name] = value
      if (carriesThemeVariable(name, value, mode)) {
        const field = CARRIED_THEME_VARIABLES[name as keyof typeof CARRIED_THEME_VARIABLES]
        carried.push({
          message: `${property} on ${where} becomes the ${mode === 'dark' ? 'dark ' : ''}${field}.`,
        })
      } else {
        lost.push({
          message: `${property} on ${where} stops applying: the design sets the portal's theme. Set it in Brand.`,
        })
      }
    }
  }
  return { vars, carried, lost }
}

interface Switched {
  design: PortalDesign
  report: DesignSwitchReport
}

/** What the portal would switch to, or null if it has no CSS of its own or the engine is off. */
async function switchedDesign(): Promise<Switched | null> {
  if (config.portalDesignEngine === 'legacy') return null
  const settings = await getWorkspaceSettings()
  const css = settings?.customCss?.trim() ?? ''
  if (!settings?.featureFlags?.portalDesignV2 || advancedCssRemainder(css) === '') return null
  const { vars, carried, lost } = cssThemeVariables(css)
  const branding = settings.brandingConfig ?? {}
  const design = convertLegacyBranding(
    legacyBrandingOf({
      ...settings.settings,
      brandingConfig: {
        ...branding,
        light: { ...branding.light, ...vars.light },
        dark: { ...branding.dark, ...vars.dark },
      },
      portalConfig: settings.portalConfig,
      customCss: css,
    })
  )
  design.css = css
  const lint = lintDesignCss(css)
  return { design, report: { errors: lint.errors, warnings: [...lost, ...lint.warnings], carried } }
}

const NONE: DesignSwitchReport = { errors: [], warnings: [], carried: [] }

export async function readDesignSwitch(): Promise<DesignSwitch> {
  const [switched, state] = await Promise.all([switchedDesign(), getDesignState()])
  if (!switched) return { available: false, canSwitchBack: false, report: NONE }
  if (state?.published) return { available: false, canSwitchBack: true, report: NONE }
  return { available: true, canSwitchBack: false, report: switched.report }
}

/**
 * The portal as it would look switched, for the preview frame beside today's.
 * Null once a design is published, or when there is nothing to switch.
 */
export async function switchPreviewView(): Promise<PortalDesignView | null> {
  const [switched, state] = await Promise.all([switchedDesign(), getDesignState()])
  if (!switched || state?.published) return null
  return portalDesignView({ engine: 'v2', doc: switched.design, revision: null })
}

/** Switches the portal to the design, its CSS carried over. Refused CSS is refused here too. */
export async function switchToDesign(
  author: DesignAuthor
): Promise<{ ok: true; number: number } | DesignRefusal> {
  return refusable(async () => {
    const switched = await switchedDesign()
    if (!switched) {
      return {
        ok: false as const,
        code: 'NOT_SWITCHABLE' as const,
        message: 'This portal has no custom CSS to switch from.',
      }
    }
    const { number } = await publishSwitchedDesign(switched.design, author)
    return { ok: true as const, number }
  })
}

/** Takes the design off the portal, so its old theme and CSS show again. */
export async function switchBackFromDesign(
  author: DesignAuthor
): Promise<{ ok: true } | DesignRefusal> {
  return refusable(async () => {
    await unpublishDesign(author)
    return { ok: true as const }
  })
}
