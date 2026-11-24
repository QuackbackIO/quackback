/**
 * A portal page at the exact address the portal routes canonicalize its search
 * to (the preview flag as a boolean, the home page's default sort included),
 * so the frame loads without a redirect first.
 */
export function portalPreviewSrc(theme: 'light' | 'dark', path: string) {
  if (path === '/') return `/?theme=${theme}&preview=true&sort=trending`
  return `${path}?theme=${theme}&preview=true`
}
