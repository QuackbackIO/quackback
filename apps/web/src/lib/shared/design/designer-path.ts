/**
 * The portal page the designer opens on and Exit returns to: a path on this
 * site only, so the designer's address can never send someone elsewhere.
 */
export function designerReturnPath(path: string | undefined): string {
  if (!path || path.length > 512) return '/'
  // One leading slash and nothing that could make it another host or scheme.
  if (!/^\/(?![/\\])/.test(path) || /[\s\\]/.test(path) || /^\/[^/]*:/.test(path)) return '/'
  return path
}

/** Which of the preview's pages a portal path is shown as. */
export function designerPreviewPage(path: string, homeOn: boolean): 'home' | 'feedback' | 'root' {
  const pathname = path.split(/[?#]/)[0]!
  if (pathname === '/feedback') return 'feedback'
  if (pathname === '/') return homeOn ? 'home' : 'root'
  return 'root'
}
