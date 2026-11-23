/**
 * Admin pages that take the whole frame: they render inside the admin frame
 * (one <main>, the admin tokens) but without the app sidebar.
 */
const FULL_PAGE_PATHS = ['/admin/settings/portal/customise']

export function isFullPageAdminPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return FULL_PAGE_PATHS.includes(path)
}
