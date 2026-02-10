import { createFileRoute } from '@tanstack/react-router'
import { buildWidgetSDK, type WidgetTheme } from '@/lib/shared/widget/sdk-template'

function jsResponse(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
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
function extractThemeFromCss(css: string): WidgetTheme {
  const theme: WidgetTheme = {}

  // Extract :root (light) block
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/)
  if (rootMatch) {
    const rootBlock = rootMatch[1]
    theme.lightPrimary = parseCssVar(rootBlock, '--primary')
    theme.lightPrimaryForeground = parseCssVar(rootBlock, '--primary-foreground')
    theme.radius = parseCssVar(rootBlock, '--radius')
  }

  // Extract .dark block
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/)
  if (darkMatch) {
    const darkBlock = darkMatch[1]
    theme.darkPrimary = parseCssVar(darkBlock, '--primary')
    theme.darkPrimaryForeground = parseCssVar(darkBlock, '--primary-foreground')
  }

  return theme
}

export const Route = createFileRoute('/api/widget/sdk.js')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getWidgetConfig, getBrandingConfig } =
          await import('@/lib/server/domains/settings/settings.service')
        const widgetConfig = await getWidgetConfig()

        if (!widgetConfig.enabled) {
          return jsResponse(
            '/* Quackback widget is disabled */ console.warn("Quackback: Widget is disabled for this workspace.");',
            60
          )
        }

        const url = new URL(request.url)
        const baseUrl = `${url.protocol}//${url.host}`

        // Resolve theme from branding for trigger button styling
        const theme: WidgetTheme = {}
        try {
          const brandingConfig = await getBrandingConfig()
          const brandingMode = brandingConfig.brandingMode ?? 'simple'
          const themeMode = brandingConfig.themeMode ?? 'user'

          theme.themeMode = themeMode

          if (brandingMode === 'advanced') {
            const { getCustomCss } = await import('@/lib/server/domains/settings/settings.service')
            const customCss = await getCustomCss()
            Object.assign(theme, extractThemeFromCss(customCss))
          } else {
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
          }
        } catch {
          // Fall back to SDK defaults
        }

        return jsResponse(buildWidgetSDK(baseUrl, theme), 3600)
      },
    },
  },
})
