/**
 * The site's own dark-mode logo, when its markup names one beside the logo
 * the measurement took: a `<picture>` source for visitors whose system is
 * dark, or a second image beside the logo that the page marks for dark mode
 * (a pair toggled by a class or an attribute). Only an image the site itself
 * serves is ever taken; nothing is recoloured or made here. Whether a
 * candidate really is drawn for dark surfaces is the app's to check, from
 * its inks.
 *
 * A pass of its own after the measurement, which leaves the logo's element
 * for it. Self-contained: it is sent as its source text and runs in the page.
 */
export interface PageDarkLogoHint {
  /** The image's address, absolute. */
  src: string
  /** How the page marks it: a dark-scheme picture source, or a dark-mode twin of the logo. */
  from: 'picture' | 'pair'
}

export function findDarkLogo(): PageDarkLogoHint | null {
  const kept = (window as unknown as Record<symbol, { logo?: unknown } | undefined>)[
    Symbol.for('quackback.reader')
  ]?.logo
  if (!(kept instanceof Element)) return null
  const absolute = (address: string | null | undefined) => {
    try {
      const url = new URL((address || '').trim(), location.href)
      return /^https?:$/.test(url.protocol) ? url.href : null
    } catch {
      return null
    }
  }
  const firstOf = (srcset: string | null) =>
    (srcset || '')
      .trim()
      .split(/\s*,\s*/)[0]
      ?.split(/\s+/)[0]

  // A picture's source for a dark system.
  const picture = kept.closest('picture')
  for (const source of picture?.querySelectorAll('source') ?? []) {
    if (!/prefers-color-scheme:\s*dark/i.test(source.getAttribute('media') || '')) continue
    const src = absolute(firstOf(source.getAttribute('srcset')))
    if (src) return { src, from: 'picture' }
  }

  // A twin beside the logo that the page marks for dark mode, shown or not.
  const own = kept instanceof HTMLImageElement ? kept.currentSrc || kept.src : ''
  const marksOf = (el: Element) =>
    `${el.getAttribute('class') || ''} ${el.id} ${el.getAttribute('data-theme') || ''} ${el.getAttribute('data-mode') || ''} ${el.getAttribute('data-color-scheme') || ''}`
  // Marked for dark mode: `dark:block`, `logo--dark`, `only-dark`, data-theme="dark";
  // never `dark:hidden`, which marks the light one.
  const forDark = (marks: string) =>
    /(?:^|[\s:_-])dark(?:$|[\s_-])|dark:(?:block|inline|flex|inline-block|inline-flex|visible)|dark-?mode|theme-dark|dark-theme|on-dark/i.test(
      marks.replace(/dark:(?:hidden|invisible|opacity-0)\S*/gi, ' ')
    )
  let scope: Element | null = kept.closest('a[href]') ?? kept.parentElement
  for (let up = 0; scope && scope !== document.body && up < 3; up++, scope = scope.parentElement) {
    const twins = [...scope.querySelectorAll('img')].filter((img) => img !== kept).slice(0, 12)
    for (const img of twins) {
      const src = absolute(
        img.currentSrc || img.getAttribute('src') || firstOf(img.getAttribute('srcset'))
      )
      if (!src || src === own) continue
      let marks = marksOf(img)
      for (let at = img.parentElement; at && at !== scope; at = at.parentElement)
        marks += ` ${marksOf(at)}`
      if (forDark(marks)) return { src, from: 'pair' }
    }
    // No further than the logo's own corner: a box holding other links is the menu's too.
    if (twins.length > 0 || (scope.parentElement?.querySelectorAll('a[href]').length ?? 0) > 1)
      break
  }
  return null
}
