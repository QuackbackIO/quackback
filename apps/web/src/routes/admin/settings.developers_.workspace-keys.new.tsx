import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/developers_/workspace-keys/new')({
  head: adminPageHead('New workspace key'),
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)
  },
  component: NewWorkspaceKeyPage,
})

// Loaded by the route's own chunk, so the list of chunks the page needs is
// not carried by the chunk every page loads.
const CreateWorkspaceKeyPage = lazy(() =>
  import('@/components/admin/settings/api-keys/create-workspace-key-page').then((mod) => ({
    default: mod.CreateWorkspaceKeyPage,
  }))
)

function NewWorkspaceKeyPage() {
  return (
    <Suspense fallback={null}>
      <CreateWorkspaceKeyPage />
    </Suspense>
  )
}
