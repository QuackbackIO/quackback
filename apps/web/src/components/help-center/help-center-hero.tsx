import type { ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'

interface HelpCenterHeroProps {
  /** 'home' shows the heading + subtitle above the search; 'compact' is search-only. */
  variant: 'home' | 'compact'
  title?: string
  description?: string
  /** The search element (rendered below the heading on home, alone on compact). */
  children: ReactNode
}

// A soft brand-tinted glow, driven by the theme's --primary so it follows
// per-tenant branding and light/dark automatically. Sits top-center behind the
// heading, the way the design pools light above the fold.
const BRAND_GLOW =
  'radial-gradient(ellipse at center, color-mix(in oklch, var(--primary) 20%, transparent), transparent 70%)'

// A faint line grid. Neutral grey reads on both light and dark; the radial mask
// concentrates it top-center and fades it out toward the edges.
const GRID_LINES =
  'linear-gradient(to right, rgb(128 128 128) 1px, transparent 1px),' +
  'linear-gradient(to bottom, rgb(128 128 128) 1px, transparent 1px)'
const GRID_MASK = 'radial-gradient(ellipse 80% 62% at 50% 0%, #000 30%, transparent 78%)'

/**
 * Full-bleed hero band shared across the help-center pages. The <section> itself
 * is never clipped so the search autocomplete dropdown and Ask-AI answer panel can
 * overflow below it; only the decorative background layer clips its own glow.
 */
export function HelpCenterHero({ variant, title, description, children }: HelpCenterHeroProps) {
  return (
    <section
      className={cn('relative w-full', variant === 'home' ? 'py-16 sm:py-24' : 'py-8 sm:py-10')}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-[0.09] dark:opacity-[0.13]"
          style={{
            backgroundImage: GRID_LINES,
            backgroundSize: '52px 52px',
            maskImage: GRID_MASK,
            WebkitMaskImage: GRID_MASK,
          }}
        />
        <div
          className="absolute -top-32 left-1/2 h-80 w-[760px] max-w-full -translate-x-1/2 blur-2xl"
          style={{ background: BRAND_GLOW }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
        {variant === 'home' && title && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem]">
              {title}
            </h1>
            {description && (
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
            <div className="mt-9">{children}</div>
          </div>
        )}
        {variant === 'compact' && children}
      </div>
    </section>
  )
}
