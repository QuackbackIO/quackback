import { z } from 'zod'
import { themePresets } from '@/lib/shared/theme/presets'
import { MINIMAL_THEME_VARIABLE_KEYS } from '@/lib/shared/theme/expand'

const themeColor = z
  .string()
  .max(120)
  .regex(/^(?:#[\da-f]{3,8}|(?:oklch|oklab|hsl|hsla|rgb|rgba)\([\d\s.,%+\-/]+\)|transparent)$/i)
const colorNames = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'accentInk',
  'destructive',
  'destructiveForeground',
  'border',
  'input',
  'ring',
  'success',
  'sidebarBackground',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
] as const
const fontStack = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[\p{L}\p{N}\s"'.,_-]+$/u)
const shadow = z
  .string()
  .max(300)
  .refine((value) => {
    if (value === 'none') return true
    const withoutColors = value.replace(
      /(?:#[\da-f]{3,8}|transparent|(?:oklch|oklab|hsl|hsla|rgb|rgba)\([\d\s.,%+\-/]+\))/gi,
      ' '
    )
    return /^(?:[\d\s.,+\-]|px|rem|em|inset)+$/.test(withoutColors)
  })
const shadowNames = [
  'shadow2xs',
  'shadowXs',
  'shadowSm',
  'shadow',
  'shadowMd',
  'shadowLg',
  'shadowXl',
  'shadow2xl',
] as const
const themeColorsSchema = z
  .object({
    ...(Object.fromEntries(colorNames.map((name) => [name, themeColor.optional()])) as Record<
      (typeof colorNames)[number],
      z.ZodOptional<typeof themeColor>
    >),
    ...(Object.fromEntries(shadowNames.map((name) => [name, shadow.optional()])) as Record<
      (typeof shadowNames)[number],
      z.ZodOptional<typeof shadow>
    >),
    fontSans: fontStack.optional(),
    radius: z
      .string()
      .regex(/^\d+(?:\.\d+)?(?:rem|px|em)$/)
      .optional(),
  })
  .strict()
export const brandingConfigSchema = z
  .object({
    preset: z
      .string()
      .refine(
        (value) => value === 'custom' || Object.hasOwn(themePresets, value),
        'Unknown theme preset'
      )
      .optional(),
    themeMode: z.enum(['light', 'dark', 'user']).optional(),
    light: themeColorsSchema.optional(),
    dark: themeColorsSchema.optional(),
  })
  .strict()
const writableThemeVariablesSchema = themeColorsSchema.pick(
  Object.fromEntries(MINIMAL_THEME_VARIABLE_KEYS.map((key) => [key, true])) as Record<
    (typeof MINIMAL_THEME_VARIABLE_KEYS)[number],
    true
  >
)
export const brandingPatchSchema = brandingConfigSchema.pick({ themeMode: true }).extend({
  light: writableThemeVariablesSchema.optional(),
  dark: writableThemeVariablesSchema.optional(),
})
export const updateThemeSchema = z.object({ brandingConfig: brandingConfigSchema })
export const updateWorkspaceNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
})
export const updateHeaderDisplayModeSchema = z.object({
  mode: z.enum(['logo_and_name', 'logo_only', 'custom_logo']),
})
export const updateHeaderDisplayNameSchema = z.object({
  name: z.string().trim().max(100).nullable(),
})
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
    displayName: updateWorkspaceNameSchema.shape.name.optional(),
  })
  .strict()
