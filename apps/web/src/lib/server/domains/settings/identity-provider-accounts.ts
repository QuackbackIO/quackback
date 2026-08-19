/**
 * Identities linked to an identity provider.
 *
 * Its own module rather than another read on `identity-providers.service`
 * because it is the one query in this area that leaves the provider tables:
 * it counts `account` rows, joined on `registrationId` (what
 * `account.provider_id` actually carries, and the leading column of
 * `account_provider_account_idx`) rather than the provider's row id.
 *
 * `deleteIdentityProvider` refuses outright while any identity references the
 * provider, since removal would orphan people whose accounts have no other way
 * back. The admin surface reads this first so the Remove control can state the
 * cost up front instead of surfacing it as a failed delete.
 */
import { account, count, db, eq, identityProvider } from '@/lib/server/db'
import type { IdentityProviderId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { wrapDbError } from './settings.helpers'

const log = logger.child({ component: 'identity-provider-accounts' })

/** Zero when the provider does not exist. */
export async function countProviderAccounts(id: IdentityProviderId): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(account)
      .innerJoin(identityProvider, eq(account.providerId, identityProvider.registrationId))
      .where(eq(identityProvider.id, id))
    return row?.n ?? 0
  } catch (error) {
    log.error({ err: error }, 'count identity provider accounts failed')
    wrapDbError('count identity provider accounts', error)
  }
}
