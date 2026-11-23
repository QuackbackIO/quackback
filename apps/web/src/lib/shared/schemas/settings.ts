import { z } from 'zod'
import { MINIMAL_THEME_VARIABLE_KEYS } from '@/lib/shared/theme/base'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import { FONT_FAMILY_NAME, FONT_UPLOADS, UPLOADED_FONT_KEY } from '@/lib/shared/theme/font-uploads'
import { CARD_STYLES } from '@/lib/shared/theme/types'

/**
 * The branding page stores what its theme editor produces. Its values
 * include named colors, CSS functions and presets that later releases may
 * retire, so the page save keeps a loose object.
 */
export const BUTTON_SHAPES = ['pill', 'corners'] as const

/**
 * An uploaded font family. The family and each key are written into the
 * theme stylesheet (`font-family`, `url()`), so each holds only characters
 * that cannot end a string, a `url()` or a rule.
 */
export const customFontSchema = z
  .object({
    family: z
      .string()
      .min(1)
      .max(64)
      .regex(FONT_FAMILY_NAME)
      .refine((family) => family === family.trim()),
    files: z
      .array(
        z
          .object({
            key: z.string().max(512).regex(UPLOADED_FONT_KEY),
            weight: z.number().int().min(100).max(900),
            weightTo: z.number().int().min(100).max(900).optional(),
            style: z.enum(['normal', 'italic']),
          })
          .strict()
          .refine((file) => file.weightTo === undefined || file.weightTo > file.weight)
      )
      .min(1)
      .max(FONT_UPLOADS.maxFiles),
    fallback: z.enum(BRANDING_FONTS.map((font) => font.id) as [string, ...string[]]),
  })
  .strict()

export const updateThemeSchema = z.object({
  brandingConfig: z
    .record(z.string(), z.unknown())
    .refine(
      (config) =>
        config.buttonShape === undefined ||
        (BUTTON_SHAPES as readonly unknown[]).includes(config.buttonShape),
      { message: 'buttonShape must be "pill" or "corners"', path: ['buttonShape'] }
    )
    .refine(
      (config) =>
        config.customFont === undefined || customFontSchema.safeParse(config.customFont).success,
      { message: 'customFont must be an uploaded font family', path: ['customFont'] }
    )
    .refine(
      (config) =>
        config.customHeadingFont === undefined ||
        customFontSchema.safeParse(config.customHeadingFont).success,
      { message: 'customHeadingFont must be an uploaded font family', path: ['customHeadingFont'] }
    )
    .refine((config) => config.headingScope === undefined || config.headingScope === 'page', {
      message: 'headingScope must be "page"',
      path: ['headingScope'],
    })
    .refine(
      (config) =>
        config.cardStyle === undefined ||
        (CARD_STYLES as readonly unknown[]).includes(config.cardStyle),
      { message: 'cardStyle must be "border", "shadow" or "flat"', path: ['cardStyle'] }
    ),
})

// Patches a model proposes are held to the narrow values the theme expander
// consumes, so a proposal can never carry CSS beyond a color, font or radius.
const themeColor = z
  .string()
  .max(120)
  .regex(/^(?:#[\da-f]{3,8}|(?:oklch|oklab|hsl|hsla|rgb|rgba)\([\d\s.,%+\-/]+\)|transparent)$/i)
const fontStack = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[\p{L}\p{N}\s"'.,_-]+$/u)
const radius = z.string().regex(/^\d+(?:\.\d+)?(?:rem|px|em)$/)
type ThemeVariableKey = (typeof MINIMAL_THEME_VARIABLE_KEYS)[number]
const writableThemeVariablesSchema = z
  .object(
    Object.fromEntries(
      MINIMAL_THEME_VARIABLE_KEYS.map((key) => [
        key,
        (key === 'fontSans' || key === 'fontHeading'
          ? fontStack
          : key === 'radius'
            ? radius
            : themeColor
        ).optional(),
      ])
    ) as Record<ThemeVariableKey, z.ZodOptional<z.ZodString>>
  )
  .strict()
export const brandingPatchSchema = z
  .object({
    themeMode: z.enum(['light', 'dark', 'user']).optional(),
    light: writableThemeVariablesSchema.optional(),
    dark: writableThemeVariablesSchema.optional(),
  })
  .strict()
export const messengerBasicsSchema = z
  .object({ enabled: z.boolean().optional(), welcomeMessage: z.string().max(500).optional() })
  .strict()
export const modulesSchema = z
  .object({
    supportInbox: z.boolean().optional(),
    supportTickets: z.boolean().optional(),
    helpCenter: z.boolean().optional(),
    statusPage: z.boolean().optional(),
  })
  .strict()
export const portalBasicsSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Name is required').max(100, 'Name too long').optional(),
  })
  .strict()

/** Stored custom CSS: the Advanced CSS remainder, at most 50KB. */
export const MAX_CUSTOM_CSS_SIZE = 50 * 1024

export const customCssSchema = z.string().max(MAX_CUSTOM_CSS_SIZE, 'Custom CSS exceeds 50KB limit')
