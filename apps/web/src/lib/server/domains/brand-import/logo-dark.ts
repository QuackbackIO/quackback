/**
 * The site's own dark-mode logo, for the logo's dark mode version: the logo
 * the browser reader saw the site show a dark system, a picture's dark
 * source, or a twin of the logo the page marks for dark mode. It is taken
 * only when it is another picture than the logo and would show on a dark
 * header. Import never makes one: a logo is not recoloured for dark mode,
 * and a candidate that would not show leaves the slot empty.
 */
import type { BrandRead } from '@/lib/shared/theme/brand-import'
import { logoShowsOn } from '@/lib/shared/theme/logo-ink'
import { inksOfMarkup, paintsShowOn } from './logo-legible'

type Logo = NonNullable<BrandRead['logo']>

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])

const samePicture = (a: Logo, b: Logo) =>
  a.svg !== undefined || b.svg !== undefined
    ? a.svg === b.svg
    : Boolean(a.raster && b.raster && sameBytes(a.raster.bytes, b.raster.bytes))

export function siteDarkLogo(
  read: Pick<BrandRead, 'logo' | 'darkLogo'>,
  darkSurface: string
): NonNullable<BrandRead['darkLogo']> | null {
  const dark = read.darkLogo
  if (!dark || !read.logo || samePicture(dark, read.logo)) return null
  // As the reader drew it, else by its markup's paints; a bitmap it could not draw is unmeasured.
  const inks = dark.svg !== undefined ? inksOfMarkup(dark.inks, dark.svg) : dark.inks
  const shows =
    logoShowsOn(inks, darkSurface) ??
    (dark.svg !== undefined ? paintsShowOn(dark.svg, darkSurface) : undefined)
  // A twin's mark may name the dark-coloured logo as well as the one for dark mode: it must be seen to show.
  if (dark.how === 'pair') return shows === true ? dark : null
  return shows === false ? null : dark
}
