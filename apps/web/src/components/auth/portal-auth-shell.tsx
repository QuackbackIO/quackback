import { useMemo } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { PortalBrandMark } from './portal-brand-mark'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import type { BrandingConfig } from '@/lib/server/domains/settings/settings.types'

interface PortalAuthShellProps {
  heading: string
  subheading?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * Shared layout for public-portal auth pages (`/auth/login`,
 * `/auth/signup`, `/auth/reset-password`).
 *
 * Renders the same branded shell the portal layout (`_portal.tsx`)
 * applies to in-portal routes: workspace theme CSS variables, brand
 * fonts, and the custom CSS override slot. Auth routes sit outside
 * `_portal` (they shouldn't render the PortalHeader nav), so we
 * re-inject the theme here so the visual handoff to a signed-in
 * portal page is seamless.
 *
 * Centered card-less pattern matching the major B2B incumbents
 * (Linear, Stripe, Vercel): brand mark anchored at top, headline +
 * optional subheading, the form, then a footer for the cross-link.
 */
export function PortalAuthShell({ heading, subheading, children, footer }: PortalAuthShellProps) {
  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingConfig?: BrandingConfig; customCss?: string }
  }
  const brandingConfig = ctx.settings?.brandingConfig
  const customCss = ctx.settings?.customCss ?? ''

  const themeStyles = useMemo(() => {
    if (!brandingConfig) return ''
    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    return hasThemeConfig ? generateThemeCSS(brandingConfig) : ''
  }, [brandingConfig])
  const googleFontsUrl = useMemo(
    () => (brandingConfig ? getGoogleFontsUrl(brandingConfig) : null),
    [brandingConfig]
  )

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[40vh] bg-[radial-gradient(ellipse_at_top,_var(--primary)/0.08,_transparent_60%)]"
      />
      <div className="relative w-full max-w-sm space-y-10">
        <div className="flex flex-col items-center gap-8 text-center">
          <PortalBrandMark />
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
            {subheading && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[36ch] mx-auto">
                {subheading}
              </p>
            )}
          </div>
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}
