import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonalApiKeys } from '@/components/settings/api-keys/personal-api-keys'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, seedAreaMessages } from '@/lib/shared/i18n'
import { isTeamMember } from '@/lib/shared/roles'

/** A teammate's own personal API keys. Portal users have none and go to their profile. */
export const Route = createFileRoute('/_portal/settings/api-keys')({
  beforeLoad: ({ context }) => {
    if (!isTeamMember(context.userRole)) throw redirect({ to: '/settings/profile' })
  },
  // The page's strings, which only it shows, load with it.
  loader: async ({ context }) => {
    // Imported here so the functions stay out of the chunk every page loads.
    const { fetchMyApiKeysFn } = await import('@/lib/server/functions/personal-api-keys')
    const [{ keys, canCreate }, messages] = await Promise.all([
      fetchMyApiKeysFn(),
      seedAreaMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE, 'personalApiKeys'),
    ])
    return { keys, canCreate, messages }
  },
  component: ApiKeysPage,
})

function ApiKeysPage() {
  const { keys, canCreate, messages } = Route.useLoaderData()
  return (
    <AreaMessages area="personalApiKeys" messages={messages}>
      <PersonalApiKeys apiKeys={keys} canCreate={canCreate} />
    </AreaMessages>
  )
}
