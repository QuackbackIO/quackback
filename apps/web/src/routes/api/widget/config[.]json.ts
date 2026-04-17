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
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean }
  imageUploadsInWidget?: boolean
  hmacRequired?: boolean
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

/** Extract theme values from :root and .dark blocks in custom CSS */
function extractThemeFromCss(css: string): ServerTheme {
  const theme: ServerTheme = {}
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/)
  if (rootMatch) {
    const rootBlock = rootMatch[1]
    theme.lightPrimary = parseCssVar(rootBlock, '--primary')
    theme.lightPrimaryForeground = parseCssVar(rootBlock, '--primary-foreground')
    theme.radius = parseCssVar(rootBlock, '--radius')
  }
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/)
  if (darkMatch) {
    const darkBlock = darkMatch[1]
    theme.darkPrimary = parseCssVar(darkBlock, '--primary')
    theme.darkPrimaryForeground = parseCssVar(darkBlock, '--primary-foreground')
  }
  return theme
}

export const Route = createFileRoute('/api/widget/config.json')({
  server: {
    handlers: {
      GET: async () => {
        const { getWidgetConfig } = await import('@/lib/server/domains/settings/settings.widget')
        const { getBrandingConfig, getCustomCss } =
          await import('@/lib/server/domains/settings/settings.media')

        const widgetConfig = await getWidgetConfig()

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
            const overrides = extractThemeFromCss(customCss)
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

        const config: ServerConfig = {
          theme: Object.keys(theme).length > 0 ? theme : undefined,
          tabs: widgetConfig.tabs,
          imageUploadsInWidget: widgetConfig.imageUploadsInWidget,
          hmacRequired: widgetConfig.identifyVerification ?? false,
        }

        return jsonResponse(config, 3600)
      },
    },
  },
})
