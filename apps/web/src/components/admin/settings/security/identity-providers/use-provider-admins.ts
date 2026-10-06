/**
 * Admins, and teammates whose role reaches admin level, who sign in with one
 * provider. The Roles card's lockout guard reads it before "Every sign-in" is
 * saved, since that choice can take their access away at their next sign-in.
 */
import { useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { IdentityProviderId } from '@quackback/ids'
import { listProviderAdminsFn } from '@/lib/server/functions/sso'
import type { ProviderAdmin } from '@/lib/server/domains/settings/identity-provider-accounts'
import { IDENTITY_PROVIDERS_KEY } from './provider-shared'

export type { ProviderAdmin }

export function useProviderAdmins(providerId: IdentityProviderId, enabled: boolean) {
  const list = useServerFn(listProviderAdminsFn)
  return useQuery({
    queryKey: [...IDENTITY_PROVIDERS_KEY, providerId, 'admins'],
    // The list holds every teammate on this provider; only admin-level access can be lost.
    queryFn: async (): Promise<ProviderAdmin[]> =>
      (await list({ data: { providerId } })).filter((p) => p.adminTier),
    enabled,
    staleTime: 30_000,
  })
}
