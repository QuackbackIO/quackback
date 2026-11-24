/**
 * The public widget "server config" — the JSON served by
 * `/api/widget/config.json` and baked into `/api/widget/sdk.js` as
 * `window.__QUACKBACK_CONFIG__` so script-tag installs can paint the launcher
 * in brand colors without a config round trip. One builder keeps the two
 * responses identical.
 */

export interface PublicServerTheme {
  lightPrimary?: string
  lightPrimaryForeground?: string
  darkPrimary?: string
  darkPrimaryForeground?: string
  radius?: string
  themeMode?: 'light' | 'dark' | 'user'
}

export interface PublicServerConfig {
  theme?: PublicServerTheme
  tabs?: {
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    messenger?: boolean
    tickets?: boolean
    home?: boolean
  }
  hmacRequired?: boolean
  visitorAnalytics?: boolean
  visitorDeviceTracking?: boolean
  /** Proactive greeting shown beside the closed launcher; empty/unset hides it. */
  launcherGreeting?: string
  /** Text label on the launcher button; empty/unset keeps the icon-only circle. */
  launcherLabel?: string
  /** Launcher corner — the admin `bottom-*` setting mapped to the SDK's side. */
  position?: 'left' | 'right'
}

/** Extract CSS variable values from a CSS string */
function parseCssVar(css: string, varName: string): string | undefined {
  const re = new RegExp(`${varName}:\\s*([^;]+)`)
  const match = css.match(re)
  return match ? match[1].trim() : undefined
}

/**
 * Normalize a CSS color value to hex so every client (web, iOS, Android) can
 * consume it the same way. Admin UIs can paste hex, rgb(), hsl(), oklab() or
 * oklch() — we coerce to hex; anything we can't recognize is dropped
 * (`undefined`) so the client uses its own default.
 */
async function toHex(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined
  const { tryCssColorToHex } = await import('@/lib/shared/theme/colors')
  return tryCssColorToHex(value) ?? undefined
}

/** Extract theme values from :root and .dark blocks in custom CSS */
async function extractThemeFromCss(css: string): Promise<PublicServerTheme> {
  const theme: PublicServerTheme = {}
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/)
  if (rootMatch) {
    const rootBlock = rootMatch[1]
    theme.lightPrimary = await toHex(parseCssVar(rootBlock, '--primary'))
    theme.lightPrimaryForeground = await toHex(parseCssVar(rootBlock, '--primary-foreground'))
    theme.radius = parseCssVar(rootBlock, '--radius')
  }
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/)
  if (darkMatch) {
    const darkBlock = darkMatch[1]
    theme.darkPrimary = await toHex(parseCssVar(darkBlock, '--primary'))
    theme.darkPrimaryForeground = await toHex(parseCssVar(darkBlock, '--primary-foreground'))
  }
  return theme
}

/**
 * The launcher's colours: the main colour as a filled button and the words
 * (or icon) on it, reading at 4.5:1 as the portal's buttons do. A words
 * colour set in custom CSS is kept where it already reads on the fill; else
 * both come from buttonOf, which may darken a mid-tone fill for white words.
 * Worked out here so the embed script ships no colour maths.
 */
async function readableLauncher(
  fill: string,
  ink: string | undefined
): Promise<{ fill: string; ink: string | undefined }> {
  const { buttonOf, contrastOf, READABLE_TEXT } = await import('@/lib/shared/theme/expand')
  const { tryCssColorToHex } = await import('@/lib/shared/theme/colors')
  if (ink && contrastOf(ink, fill) >= READABLE_TEXT) return { fill, ink }
  const button = buttonOf(fill)
  return {
    fill: tryCssColorToHex(button.fill) ?? fill,
    ink: tryCssColorToHex(button.ink) ?? undefined,
  }
}

/**
 * Build the public server config. `enabled: false` means the widget is off
 * for this workspace and callers should serve their disabled variant.
 *
 * Every read below goes through the Redis-cached workspace settings (see
 * requireSettingsCached / isFeatureEnabled), so a warm request costs a single
 * Redis GET rather than repeated settings-row queries.
 */
export async function getPublicServerConfig(): Promise<{
  enabled: boolean
  config: PublicServerConfig
}> {
  const { getPublicWidgetConfig, getWidgetConfig } =
    await import('@/lib/server/domains/settings/settings.widget')

  // Public projection: tabs are already flag-gated (e.g. messenger behind
  // the experimental `supportInbox` flag), so this just forwards them.
  const widgetConfig = await getPublicWidgetConfig()
  if (!widgetConfig.enabled) {
    return { enabled: false, config: {} }
  }

  // The visitor-tracking switches are not in the public projection; they are
  // read from the parsed settings and resolved against the plan here.
  const { isVisitorAnalyticsEntitled, resolveVisitorTracking } =
    await import('@/lib/server/domains/analytics/visitor-tracking')
  const [stored, entitled] = await Promise.all([getWidgetConfig(), isVisitorAnalyticsEntitled()])
  const tracking = resolveVisitorTracking({
    entitled,
    analytics: stored.visitorAnalytics,
    deviceId: stored.visitorDeviceTracking,
  })

  const theme: PublicServerTheme = {}
  try {
    const { getBrandingConfig, getCustomCss } =
      await import('@/lib/server/domains/settings/settings.media')
    const brandingConfig = await getBrandingConfig()
    theme.themeMode = brandingConfig.themeMode ?? 'user'

    const { cssColorToHex } = await import('@/lib/shared/theme/colors')
    const light = brandingConfig.light
    const dark = brandingConfig.dark
    // The stored words colour is not sent: the portal draws its buttons'
    // words from the fill (buttonOf), and so does the launcher below.
    const stored = {
      light: light?.primary ? cssColorToHex(light.primary) : undefined,
      dark: dark?.primary ? cssColorToHex(dark.primary) : undefined,
    }
    if (light?.radius) theme.radius = light.radius

    // Custom CSS paused after the plan limits grace is kept but not applied.
    const customCss = await getCustomCss()
    const { isFeaturePaused } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
    const overrides =
      customCss && !(await isFeaturePaused('customCss'))
        ? await extractThemeFromCss(customCss)
        : ({} as PublicServerTheme)
    if (overrides.radius) theme.radius = overrides.radius

    const lightFill = overrides.lightPrimary ?? stored.light
    const darkFill =
      overrides.darkPrimary ??
      stored.dark ??
      (overrides.darkPrimaryForeground ? lightFill : undefined)
    const lightPair = lightFill
      ? await readableLauncher(lightFill, overrides.lightPrimaryForeground)
      : null
    const darkPair = darkFill
      ? await readableLauncher(darkFill, overrides.darkPrimaryForeground)
      : null
    if (lightPair) {
      theme.lightPrimary = lightPair.fill
      theme.lightPrimaryForeground = lightPair.ink
    }
    if (darkPair) {
      theme.darkPrimary = darkPair.fill
      theme.darkPrimaryForeground = darkPair.ink
    }
  } catch {
    // Fall back to SDK defaults — theme stays empty
  }

  return {
    enabled: true,
    config: {
      theme: Object.keys(theme).length > 0 ? theme : undefined,
      tabs: widgetConfig.tabs,
      hmacRequired: widgetConfig.hmacRequired,
      visitorAnalytics: tracking.analytics,
      visitorDeviceTracking: tracking.deviceTracking,
      launcherGreeting: widgetConfig.launcherGreeting?.trim() || undefined,
      launcherLabel: widgetConfig.launcherLabel?.trim() || undefined,
      position:
        widgetConfig.position === 'bottom-left'
          ? 'left'
          : widgetConfig.position === 'bottom-right'
            ? 'right'
            : undefined,
    },
  }
}
