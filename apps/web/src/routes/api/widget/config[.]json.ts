import { createFileRoute } from '@tanstack/react-router'

interface ServerTheme {
  lightPrimary?: string
  lightPrimaryForeground?: string
  darkPrimary?: string
  darkPrimaryForeground?: string
  radius?: string
  themeMode?: 'light' | 'dark' | 'user'
}

interface ServerConfig {
  theme?: ServerTheme
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean; chat?: boolean; home?: boolean }
  hmacRequired?: boolean
  visitorAnalytics?: boolean
  visitorDeviceTracking?: boolean
}

function jsonResponse(body: unknown, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  })
}

/** Extract CSS variable values from a CSS string */
function parseCssVar(css: string, varName: string): string | undefined {
  const re = new RegExp(`${varName}:\\s*([^;]+)`)
  const match = css.match(re)
  return match ? match[1].trim() : undefined
}

/**
 * Normalize a CSS color value to hex so every client (web, iOS, Android) can
 * consume it the same way. Admin UIs can paste `oklch(...)`, rgb, or hex — we
 * coerce to hex; anything we can't recognize is dropped (`undefined`) so the
 * client uses its own default.
 */
async function toHex(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed
  if (/^oklch\(/i.test(trimmed)) {
    const { oklchToHex } = await import('@/lib/shared/theme/colors')
    return oklchToHex(trimmed)
  }
  return undefined
}

/** Extract theme values from :root and .dark blocks in custom CSS */
async function extractThemeFromCss(css: string): Promise<ServerTheme> {
  const theme: ServerTheme = {}
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

export const Route = createFileRoute('/api/widget/config.json')({
  server: {
    handlers: {
      GET: async () => {
        const { getPublicWidgetConfig } =
          await import('@/lib/server/domains/settings/settings.widget')
        const { getBrandingConfig, getCustomCss } =
          await import('@/lib/server/domains/settings/settings.media')

        // Public projection: tabs are already flag-gated (e.g. chat behind the
        // experimental `chat` flag), so this endpoint just forwards them.
        const widgetConfig = await getPublicWidgetConfig()

        if (!widgetConfig.enabled) {
          return jsonResponse({ enabled: false }, 60)
        }

        const theme: ServerTheme = {}
        try {
          const brandingConfig = await getBrandingConfig()
          theme.themeMode = brandingConfig.themeMode ?? 'user'

          const { oklchToHex } = await import('@/lib/shared/theme/colors')
          const light = brandingConfig.light
          const dark = brandingConfig.dark
          if (light?.primary) theme.lightPrimary = oklchToHex(light.primary)
          if (light?.primaryForeground)
            theme.lightPrimaryForeground = oklchToHex(light.primaryForeground)
          if (dark?.primary) theme.darkPrimary = oklchToHex(dark.primary)
          if (dark?.primaryForeground)
            theme.darkPrimaryForeground = oklchToHex(dark.primaryForeground)
          if (light?.radius) theme.radius = light.radius

          const customCss = await getCustomCss()
          if (customCss) {
            const overrides = await extractThemeFromCss(customCss)
            if (overrides.lightPrimary) theme.lightPrimary = overrides.lightPrimary
            if (overrides.lightPrimaryForeground)
              theme.lightPrimaryForeground = overrides.lightPrimaryForeground
            if (overrides.darkPrimary) theme.darkPrimary = overrides.darkPrimary
            if (overrides.darkPrimaryForeground)
              theme.darkPrimaryForeground = overrides.darkPrimaryForeground
            if (overrides.radius) theme.radius = overrides.radius
          }
        } catch {
          // Fall back to SDK defaults — theme stays empty
        }

        const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
        const visitorAnalytics = await isFeatureEnabled('visitorAnalytics')

        const config: ServerConfig = {
          theme: Object.keys(theme).length > 0 ? theme : undefined,
          tabs: widgetConfig.tabs,
          hmacRequired: widgetConfig.hmacRequired,
          visitorAnalytics,
          // The durable device id is only meaningful with analytics on.
          visitorDeviceTracking:
            visitorAnalytics && (await isFeatureEnabled('visitorDeviceTracking')),
        }

        return jsonResponse(config, 3600)
      },
    },
  },
})
