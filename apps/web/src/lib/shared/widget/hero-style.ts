/**
 * Widget Home hero backdrop styling — shared by the widget renderer and the
 * admin settings thumbnails so both always show the same thing.
 *
 * The backdrop fills the whole widget panel (behind the header row, greeting,
 * and cards) and dissolves into the page background toward the bottom so the
 * tab bar area stays calm.
 *
 * Colors come from admin config as strict hex (validated at the server
 * boundary); absent/empty falls back to the theme's primary via color-mix,
 * so the default stays brand-tinted and follows theme changes for free.
 */
import type { CSSProperties } from 'react'
import type { WidgetHeroPatternId, WidgetHomeConfig } from '@/lib/shared/types/settings'

export const WIDGET_HERO_PATTERNS: { id: WidgetHeroPatternId; name: string }[] = [
  { id: 'mesh', name: 'Mesh' },
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid' },
  { id: 'waves', name: 'Waves' },
]

/** Translucent tint of a configured hex color, or the theme primary. */
function tint(color: string | undefined, pct: number): string {
  const base = color?.trim() || 'var(--primary)'
  return `color-mix(in oklab, ${base} ${pct}%, transparent)`
}

/** Dissolve the backdrop into the page background before the panel's bottom. */
const FADE_MASK: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, black 35%, transparent 90%)',
  WebkitMaskImage: 'linear-gradient(to bottom, black 35%, transparent 90%)',
}

function patternStyle(
  pattern: WidgetHeroPatternId | undefined,
  from: string | undefined,
  to: string | undefined
): CSSProperties {
  const ink = tint(from, 45)
  const soft = tint(to ?? from, 22)
  // Soft color wash layered under the geometric motifs — the atmospheric
  // depth that makes the mesh work; a bare repeating pattern over a flat
  // background reads as wallpaper.
  const wash = [
    `radial-gradient(120% 60% at 8% 0%, ${tint(from, 26)}, transparent 55%)`,
    `radial-gradient(110% 50% at 95% 8%, ${tint(to ?? from, 13)}, transparent 60%)`,
  ]
  switch (pattern) {
    case 'dots':
      // Two dot lattices offset by half a cell (a diamond arrangement), the
      // second in the secondary tint so both swatches read.
      return {
        backgroundImage: [
          `radial-gradient(circle at 1px 1px, ${tint(from, 20)} 1.2px, transparent 1.2px)`,
          `radial-gradient(circle at 1px 1px, ${tint(to ?? from, 13)} 1.2px, transparent 1.2px)`,
          ...wash,
        ].join(', '),
        backgroundSize: '20px 20px, 20px 20px, auto, auto',
        backgroundPosition: '0 0, 10px 10px, 0 0, 0 0',
        ...FADE_MASK,
      }
    case 'grid':
      return {
        backgroundImage: [
          `linear-gradient(${tint(to ?? from, 8)} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${tint(to ?? from, 8)} 1px, transparent 1px)`,
          ...wash,
        ].join(', '),
        backgroundSize: '26px 26px, 26px 26px, auto, auto',
        ...FADE_MASK,
      }
    case 'waves':
      // Soft ripples cascading down from above the header — wide bands with
      // gradient edges instead of hard 2px rings.
      return {
        backgroundImage: [
          `repeating-radial-gradient(140% 110% at 50% -40%, transparent 0 24px, ${tint(to ?? from, 9)} 33px, transparent 42px)`,
          ...wash,
        ].join(', '),
        ...FADE_MASK,
      }
    case 'mesh':
    default:
      return {
        backgroundImage: [
          `radial-gradient(120% 60% at 8% 0%, ${ink}, transparent 55%)`,
          `radial-gradient(110% 50% at 95% 8%, ${soft}, transparent 60%)`,
          `radial-gradient(90% 45% at 55% 60%, ${tint(to ?? from, 14)}, transparent 65%)`,
        ].join(', '),
        ...FADE_MASK,
      }
  }
}

/**
 * Inline style for the hero backdrop layer, or null when the style is
 * plain/image (image renders its own <img> + scrim).
 */
export function heroBackdropStyle(
  home: Pick<WidgetHomeConfig, 'headerStyle' | 'gradient' | 'pattern'> | null | undefined
): CSSProperties | null {
  if (!home) return null
  const { headerStyle, gradient, pattern } = home
  if (headerStyle === 'gradient') {
    return {
      backgroundImage: `linear-gradient(to bottom, ${tint(gradient?.from, 30)}, ${tint(
        gradient?.to ?? gradient?.from,
        12
      )} 55%, transparent 90%)`,
    }
  }
  if (headerStyle === 'pattern') {
    return patternStyle(pattern, gradient?.from, gradient?.to)
  }
  return null
}
