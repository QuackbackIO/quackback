import { z } from 'zod'
import { variableMap } from '@/lib/shared/theme/generator'
import { CARD_STYLES } from '@/lib/shared/theme/types'
import { BUTTON_SHAPES, customCssSchema, customFontSchema } from '@/lib/shared/schemas/settings'
import { updatePortalConfigSchema } from '@/lib/shared/schemas/portal-config'
import { updateHelpCenterConfigSchema } from '@/lib/shared/schemas/help-center'
import type {
  BrandingConfig,
  HeaderDisplayMode,
  HelpCenterHeaderLink,
  PortalNavConfig,
  PortalWelcomeCard,
} from '@/lib/server/domains/settings'

/**
 * One publish of the portal's look: the name in its header, theme, Advanced CSS, tabs,
 * welcome message, Help Center home and the wide logo, written together or
 * not at all.
 */

/** Brackets and quotes close in order, so a value cannot leave a function or string open. */
function balanced(value: string): boolean {
  const open: string[] = []
  for (const char of value) {
    const quote = open.at(-1)
    if (quote === '"' || quote === "'") {
      if (char === quote) open.pop()
    } else if (char === '"' || char === "'" || char === '(') open.push(char)
    else if (char === ')' && open.pop() !== '(') return false
  }
  return open.length === 0
}

/**
 * A theme variable value. The values are written into the theme stylesheet
 * every visitor loads, so none may end its declaration or block, open markup,
 * a comment or an escape, or leave a bracket or quote open: any of those can
 * swallow or rewrite the rest of the stylesheet. Hand-written CSS values
 * (named colours, `var()`) stay allowed, as the editor produces them.
 */
const themeValue = z
  .string()
  .max(500)
  .refine(
    (value) => !/[<{};\\]|\/\*|\*\//.test(value) && balanced(value),
    'Theme values must be plain CSS values'
  )

/** The theme variables the stylesheet generator writes, and nothing else. */
const themeVariables = z
  .object(Object.fromEntries(Object.keys(variableMap).map((key) => [key, themeValue.optional()])))
  .strict()

/** Button corners: pill (the default) or the theme's corner radius. */
export const buttonShapeSchema = z.enum(BUTTON_SHAPES)

/**
 * The full theme the editor publishes. Stricter than the page save it
 * replaces (a loose record): the known keys and theme variables only, each a
 * plain CSS value.
 */
export const portalThemeSchema = z
  .object({
    preset: z.string().max(64).optional(),
    themeMode: z.enum(['light', 'dark', 'user']).optional(),
    buttonShape: buttonShapeSchema.optional(),
    customFont: customFontSchema.optional(),
    cardStyle: z.enum(CARD_STYLES).optional(),
    customHeadingFont: customFontSchema.optional(),
    headingScope: z.enum(['page']).optional(),
    light: themeVariables.optional(),
    dark: themeVariables.optional(),
  })
  .strict()

/** A stored header (wide) logo: an object this workspace uploaded under header-logos/. */
export const wideLogoKeySchema = z
  .string()
  .max(512)
  .regex(/^header-logos\/[a-zA-Z0-9_./-]+$/, 'Choose a header logo you uploaded.')
  .refine((key) => !key.includes('..'), 'Choose a header logo you uploaded.')

/**
 * The workspace icon: the square mark the browser tab, emails and sign-in use,
 * with the small favicon made from it. Both are uploads of this workspace's
 * (logos/, favicons/), published together.
 */
const uploadKey = (prefix: string, message: string) =>
  z
    .string()
    .max(512)
    .regex(new RegExp(`^${prefix}\\/[a-zA-Z0-9_./-]+$`), message)
    .refine((key) => !key.includes('..'), message)
export const iconSchema = z
  .object({
    key: uploadKey('logos', 'Choose an icon you uploaded.'),
    faviconKey: uploadKey('favicons', 'Choose an icon you uploaded.'),
  })
  .strict()
export type PortalIcon = z.infer<typeof iconSchema>
/** An icon as stored: one saved before favicons were made from it may have none. */
export type StoredPortalIcon = { key: string; faviconKey: string | null }

export const headerDisplayModeSchema = z.enum(['logo_and_name', 'logo_only', 'custom_logo'])

const portalPartsSchema = z
  .object({
    nav: updatePortalConfigSchema.shape.nav,
    welcomeCard: updatePortalConfigSchema.shape.welcomeCard,
  })
  .strict()

const helpCenterPartsSchema = updateHelpCenterConfigSchema.strict()

const logoPartsSchema = z
  .object({
    wideKey: wideLogoKeySchema.nullable().optional(),
    // The logo's dark mode version: an upload of the same kind, or null for none.
    darkKey: wideLogoKeySchema.nullable().optional(),
    headerDisplayMode: headerDisplayModeSchema.optional(),
    icon: iconSchema.optional(),
  })
  .strict()

/**
 * What the editor loaded for each part it publishes: the values as the read
 * path returns them. Compared with what is stored, never written, so they are
 * not validated beyond their place. An absent value is sent as null.
 */
const beforeSchema = z
  .object({
    headerName: z.unknown().optional(),
    theme: z.unknown().optional(),
    customCss: z.unknown().optional(),
    portal: z.object({ nav: z.unknown(), welcomeCard: z.unknown() }).partial().optional(),
    helpCenter: z
      .object({
        homepageTitle: z.unknown(),
        homepageDescription: z.unknown(),
        headerLinks: z.unknown(),
      })
      .partial()
      .optional(),
    logo: z
      .object({
        wideKey: z.unknown(),
        darkKey: z.unknown(),
        headerDisplayMode: z.unknown(),
        icon: z.unknown(),
      })
      .partial()
      .optional(),
  })
  .strict()

/**
 * The person's confirmation that the brand assets Import brought in (the
 * site's logo, icon or font files) are the brand's own or licensed to it:
 * the site they came from, which of them this publish carries (the text's
 * font and the headings' are two), and which of those were in use from the
 * start because the portal is on the site's domain, never confirmed by a
 * click. It changes no setting; the publish records it with who published
 * and when.
 */
const brandAssetSchema = z.enum(['logo', 'icon', 'font', 'headingFont'])
export const brandAssetsConfirmationSchema = z
  .object({
    host: z
      .string()
      .max(253)
      .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, 'The imported site must be a host name.'),
    assets: z.array(brandAssetSchema).min(1).max(4),
    preTicked: z.array(brandAssetSchema).max(4),
  })
  .strict()

/**
 * `settings.metadata.brandImport`: the website the published look was last
 * imported from. A publish that carries an import writes it; any other
 * publish clears it, so the launch plan says "Customised" from then on.
 */
export const brandImportSchema = z
  .object({ host: brandAssetsConfirmationSchema.shape.host })
  .strict()

/**
 * The name the portal's header shows beside the icon. Empty for none of its
 * own: the header then shows the workspace's name, which emails, sign-in and
 * page titles always use.
 */
export const headerNameSchema = z.string().trim().max(100)

export const publishPortalCustomisationSchema = z
  .object({
    before: beforeSchema,
    headerName: headerNameSchema.optional(),
    theme: portalThemeSchema.optional(),
    customCss: customCssSchema.optional(),
    portal: portalPartsSchema.optional(),
    helpCenter: helpCenterPartsSchema.optional(),
    logo: logoPartsSchema.optional(),
    brandAssets: brandAssetsConfirmationSchema.optional(),
    /** The website this publish's look was imported from, when it carries an import. */
    importedFrom: brandImportSchema.shape.host.optional(),
  })
  .strict()

export type PublishPortalCustomisationInput = z.input<typeof publishPortalCustomisationSchema>

/** Each part a publish can carry, as named in conflicts, refusals and the audit log. */
export const PORTAL_CUSTOMISE_PARTS = [
  'headerName',
  'theme',
  'customCss',
  'portal.nav',
  'portal.welcomeCard',
  'helpCenter.homepageTitle',
  'helpCenter.homepageDescription',
  'helpCenter.headerLinks',
  'logo.wideKey',
  'logo.darkKey',
  'logo.headerDisplayMode',
  'logo.icon',
] as const

export type PortalCustomisePart = (typeof PORTAL_CUSTOMISE_PARTS)[number]

/** Part values in the publish shape: `{ theme, portal: { nav } }` and so on. */
export type PortalCustomiseValues = {
  /** The name in the portal's header; empty when it shows the workspace's. */
  headerName?: string
  theme?: BrandingConfig
  customCss?: string
  portal?: { nav?: PortalNavConfig | null; welcomeCard?: PortalWelcomeCard | null }
  helpCenter?: {
    homepageTitle?: string
    homepageDescription?: string
    headerLinks?: HelpCenterHeaderLink[]
  }
  logo?: {
    wideKey?: string | null
    /** The logo's dark mode version, or null when there is none. */
    darkKey?: string | null
    headerDisplayMode?: HeaderDisplayMode
    /** The icon and its favicon, or null when the workspace has none. */
    icon?: StoredPortalIcon | null
  }
}

export type PublishPortalCustomisationResult =
  | {
      ok: true
      /** The parts this publish changed (parts equal to what was stored are left out). */
      parts: PortalCustomisePart[]
      /** The stored value of every part sent, as the read path returns it: the next `before`. */
      published: PortalCustomiseValues
    }
  | {
      ok: false
      /**
       * The publish would put live a logo, icon or commercial font Import
       * brought in, and nobody confirmed the brand owns or licenses it.
       * Nothing is written; the editor asks, then publishes again.
       */
      code: 'BRAND_ASSETS_UNCONFIRMED'
      message: string
      assets: z.infer<typeof brandAssetSchema>[]
    }
  | {
      ok: false
      code: 'SETTINGS_CHANGED'
      message: string
      /** The parts someone else changed since the editor loaded them. */
      parts: PortalCustomisePart[]
      /** Their current values. */
      current: PortalCustomiseValues
    }
