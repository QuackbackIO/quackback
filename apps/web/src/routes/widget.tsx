import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { WidgetAuthProvider } from '@/components/widget/widget-auth-provider'

export const Route = createFileRoute('/widget')({
  loader: async ({ context }) => {
    const { settings } = context

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    const { setResponseHeader } = await import('@tanstack/react-start/server')
    setResponseHeader('Content-Security-Policy', 'frame-ancestors *')
    setResponseHeader('X-Frame-Options', 'ALLOWALL')

    const brandingData = settings.brandingData ?? null
    const brandingConfig = settings.brandingConfig ?? {}
    const customCss = settings.customCss ?? ''
    const brandingMode = brandingConfig.brandingMode ?? 'simple'
    const themeMode = brandingConfig.themeMode ?? 'user'

    const hasThemeConfig = brandingConfig.preset || brandingConfig.light || brandingConfig.dark
    const themeStyles =
      brandingMode === 'simple' && hasThemeConfig ? generateThemeCSS(brandingConfig) : ''

    return {
      org,
      brandingData,
      themeMode,
      themeStyles,
      customCss: brandingMode === 'advanced' ? customCss : '',
      googleFontsUrl: brandingMode === 'simple' ? getGoogleFontsUrl(brandingConfig) : null,
    }
  },
  // Force theme via meta tag so the root's systemThemeScript applies it
  // before first paint — prevents white flash in dark mode
  head: ({ loaderData }) => {
    const themeMode = loaderData?.themeMode ?? 'user'
    const meta: Array<Record<string, string>> = []
    if (themeMode !== 'user') {
      meta.push({ name: 'theme-forced', content: themeMode })
    }
    return { meta }
  },
  component: WidgetLayout,
})

function WidgetLayout() {
  const { themeStyles, customCss, googleFontsUrl } = Route.useLoaderData()

  return (
    <WidgetAuthProvider>
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { overflow: hidden; margin: 0; }
            html, body, #root { height: 100%; }
            /* Prevent white flash before theme resolves */
            html.system { background: #fff; }
            @media (prefers-color-scheme: dark) {
              html.system { background: #09090b; }
            }
          `,
        }}
      />
      <Outlet />
    </WidgetAuthProvider>
  )
}
