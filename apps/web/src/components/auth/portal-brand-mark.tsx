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
 * than an isolated generic auth shell.
 *
 * Reads `settings.brandingData` from the route context — the root
 * loader populates this for every portal request, so no extra fetch
 * happens here.
 */
export function PortalBrandMark({ variant = 'stack' }: PortalBrandMarkProps) {
  const ctx = useRouteContext({ from: '__root__' }) as {
    settings?: { brandingData?: SettingsBrandingData }
  }
  const branding = ctx.settings?.brandingData
  const name = branding?.name ?? 'Quackback'
  const logo = branding?.headerLogoUrl ?? branding?.logoUrl ?? null
  const initial = name.charAt(0).toUpperCase()

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
