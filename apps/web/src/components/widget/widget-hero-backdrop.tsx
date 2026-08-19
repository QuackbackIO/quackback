import { heroBackdropStyle } from '@/lib/shared/widget/hero-style'
import type { WidgetHomeConfig } from '@/lib/shared/types/settings'

/**
 * Full-panel Home backdrop — sits behind the shell header row, greeting, and
 * cards so the configured gradient/pattern/image fills the whole widget
 * instead of stopping at a band under the greeting. Content stays readable
 * because the style layer dissolves into the page background toward the
 * bottom (mask/scrim baked into the shared style helper).
 */
export function WidgetHeroBackdrop({ home }: { home: WidgetHomeConfig | null }) {
  const overImage = home?.headerStyle === 'image' && !!home.heroImageUrl
  const style = heroBackdropStyle(home)
  if (!overImage && !style) return null
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      {overImage ? (
        <>
          <img src={home?.heroImageUrl ?? ''} alt="" className="h-full w-full object-cover" />
          {/* Scrim: dark at the top for header/greeting contrast, fading into
              the app background so the cards stay readable. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-background" />
        </>
      ) : (
        <div className="absolute inset-0" style={style ?? undefined} />
      )}
    </div>
  )
}
