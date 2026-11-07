import type { Role } from '@/lib/shared/roles'

/**
 * The designer's canvas draws the portal as a signed-in visitor sees it,
 * without the team's own controls. Drawing only: every request the page makes
 * is still checked against the real session.
 */
export function asVisitorInDesigner<
  T extends { session?: { user?: unknown } | null; userRole?: Role | null },
>(context: T, search: Record<string, unknown>): T {
  const designer = search.designer !== undefined && !!search.preview
  return designer && context.session?.user ? { ...context, userRole: 'user' } : context
}
