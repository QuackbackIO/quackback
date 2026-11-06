import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonalApiKeys } from '@/components/settings/api-keys/personal-api-keys'
import { fetchMyApiKeysFn } from '@/lib/server/functions/personal-api-keys'
import { isTeamMember } from '@/lib/shared/roles'

/** A teammate's own personal API keys. Portal users have none and go to their profile. */
export const Route = createFileRoute('/_portal/settings/api-keys')({
  beforeLoad: ({ context }) => {
    if (!isTeamMember(context.userRole)) throw redirect({ to: '/settings/profile' })
  },
  loader: () => fetchMyApiKeysFn(),
  component: ApiKeysPage,
})

function ApiKeysPage() {
  const { keys, canCreate } = Route.useLoaderData()
  return <PersonalApiKeys apiKeys={keys} canCreate={canCreate} />
}
