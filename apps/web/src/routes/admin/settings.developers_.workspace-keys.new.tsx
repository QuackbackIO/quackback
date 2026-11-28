import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/developers_/workspace-keys/new')({
  head: adminPageHead('New workspace key'),
  beforeLoad: ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/developers/workspace-keys/new')
  },
  loader: async ({ context }) => ({
    seededAreas: await seedAdminAreas(context.personLocale, 'adminIntegrationSettings'),
  }),
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
