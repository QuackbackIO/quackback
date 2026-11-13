/**
 * What a role can do in the Status admin, from the two server gates:
 * status_page.publish runs incidents and maintenance (the overview, the
 * incident lists and editor, reading templates), and status_page.manage
 * reshapes the page (services, groups, template edits, subscribers,
 * settings). Render-only, like every client permission check: the server
 * enforces each read and write on its own. A view the role can't read shows
 * a no-access state rather than a skeleton waiting on reads that 403, and
 * an action it can't use isn't offered.
 */
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { useHasPermission } from '@/lib/client/hooks/use-root-context'
import { PERMISSIONS } from '@/lib/shared/permissions'

export type StatusAdminView =
  'overview' | 'open' | 'maintenance' | 'all' | 'components' | 'templates' | 'subscribers'

export interface StatusAccess {
  canPublish: boolean
  canManage: boolean
}

export function useStatusAccess(): StatusAccess {
  return {
    canPublish: useHasPermission(PERMISSIONS.STATUS_PAGE_PUBLISH),
    canManage: useHasPermission(PERMISSIONS.STATUS_PAGE_MANAGE),
  }
}

/** The permission a view's reads need. Templates are listed for publishers
 *  (the composers' picker reads them); editing them is manage. */
const VIEW_PERMISSION: Record<StatusAdminView, keyof StatusAccess> = {
  overview: 'canPublish',
  open: 'canPublish',
  maintenance: 'canPublish',
  all: 'canPublish',
  templates: 'canPublish',
  components: 'canManage',
  subscribers: 'canManage',
}

export function canOpenStatusView(view: StatusAdminView, access: StatusAccess): boolean {
  return access[VIEW_PERMISSION[view]]
}

/** Where the Status admin opens when no view is asked for: the overview, or
 *  for a role that can only manage the page, its services. */
export function defaultStatusView(access: StatusAccess): StatusAdminView | null {
  if (access.canPublish) return 'overview'
  if (access.canManage) return 'components'
  return null
}

/** The no-access state for a view, or for the whole Status admin. */
export function StatusNoAccess({ view }: { view?: StatusAdminView }) {
  const needs = view ? VIEW_PERMISSION[view] : null
  const description =
    needs === 'canPublish'
      ? 'Viewing and running incidents and maintenance needs the status_page.publish permission. Ask a workspace admin to add it to your role.'
      : needs === 'canManage'
        ? 'Managing services and subscribers needs the status_page.manage permission. Ask a workspace admin to add it to your role.'
        : 'The status page needs the status_page.publish permission to run incidents, or status_page.manage to manage the page. Ask a workspace admin to add one to your role.'
  return (
    <EmptyState
      icon={LockClosedIcon}
      title={view ? "You don't have access to this" : "You don't have access to the status page"}
      description={description}
      className="flex-1"
    />
  )
}
