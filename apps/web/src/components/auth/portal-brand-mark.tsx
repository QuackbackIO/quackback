import { nameInitial } from '@/lib/shared/utils/initial'
import {
  portalWideLogoDarkUrl,
  portalWideLogoUrl,
  WIDE_LOGO_CLASS,
} from '@/lib/shared/portal-wide-logo'
import { WideLogo } from '@/components/public/wide-logo'
import { Link } from '@tanstack/react-router'
import { useRouteContext } from '@tanstack/react-router'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'

interface PortalBrandMarkProps {
  /** Layout variant. `stack` (default) puts the logo above the name —
   *  used by the public-portal auth pages where the mark is the visual
   *  anchor. `row` keeps logo + name on one line for inline contexts. */
  variant?: 'stack' | 'row'
}

/**
 * Brand mark for the public-portal auth pages. Renders the org logo +
 * name above the form so these pages read as part of the portal rather
 * than an isolated generic auth shell, or the wide logo alone when the
 * portal header shows it.
 *
 * Reads `settings.brandingData` from the route context — the root
 * loader populates this for every portal request, so no extra fetch
 * happens here.
 */
export function PortalBrandMark({ variant = 'stack' }: PortalBrandMarkProps) {
  const branding = useRouteContext({
    from: '__root__',
    select: (context) =>
      (context as { settings?: { brandingData?: SettingsBrandingData } }).settings?.brandingData,
  })
  const name = branding?.name ?? 'Quackback'
  const wideLogo = portalWideLogoUrl(branding)
  // The square logo, as the portal header shows it. A wide logo cropped to a
  // square is unreadable, so it is used only when there is no square one.
  const logo = branding?.logoUrl ?? branding?.headerLogoUrl ?? null
  const initial = nameInitial(name)

  if (wideLogo) {
    // A wordmark carries the name, so it stands alone, as in the portal header.
    return (
      <Link to="/" className="inline-flex items-center">
        <WideLogo
          src={wideLogo}
          darkSrc={portalWideLogoDarkUrl(branding)}
          alt={name}
          className={
            variant === 'row' ? WIDE_LOGO_CLASS : 'h-12 w-auto max-w-[240px] object-contain'
          }
        />
      </Link>
    )
  }

  if (variant === 'row') {
    return (
      <Link to="/" className="inline-flex items-center gap-2.5 group">
        <BrandIcon logo={logo} name={name} initial={initial} size="sm" />
        <span className="font-semibold max-w-[20ch] line-clamp-1 group-hover:underline underline-offset-4">
          {name}
        </span>
      </Link>
    )
  }

  return (
    <Link to="/" className="inline-flex flex-col items-center gap-3 group">
      <BrandIcon logo={logo} name={name} initial={initial} size="lg" />
      <span className="text-sm font-medium text-muted-foreground max-w-[28ch] text-center line-clamp-2 group-hover:text-foreground transition-colors">
        {name}
      </span>
    </Link>
  )
}

function BrandIcon({
  logo,
  name,
  initial,
  size,
}: {
  logo: string | null
  name: string
  initial: string
  size: 'sm' | 'lg'
}) {
  const sizing = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-9 w-9 text-base'
  return logo ? (
    <img src={logo} alt={name} className={`${sizing} [border-radius:calc(var(--radius)*0.8)]`} />
  ) : (
    <div
      className={`${sizing} [border-radius:calc(var(--radius)*0.8)] bg-primary flex items-center justify-center text-primary-foreground font-semibold`}
    >
      {initial}
    </div>
  )
}
