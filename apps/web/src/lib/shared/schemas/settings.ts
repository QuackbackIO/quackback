import { z } from 'zod'
import { MINIMAL_THEME_VARIABLE_KEYS } from '@/lib/shared/theme/expand'

/**
 * The branding page stores what its theme editor produces. Its values
 * include named colors, CSS functions and presets that later releases may
 * retire, so the page save keeps a loose object.
 */
export const updateThemeSchema = z.object({
  brandingConfig: z.record(z.string(), z.unknown()),
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
        (key === 'fontSans' ? fontStack : key === 'radius' ? radius : themeColor).optional(),
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
