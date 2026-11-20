/**
 * Provider-logo write path — the S3 key on an `identity_provider` row, with the
 * same lifecycle as `settings.logo_key` (see `settings.media.ts`).
 *
 * Split out of `identity-providers.service.ts` so an image upload is never
 * entangled with a connection edit: the logo feeds only the rendered sign-in
 * button, which the settings cache holds (`getPublicOidcProviders`). Each write
 * bumps the settings row's auth config version in the same transaction, as
 * every other identity provider write does, so a settings read that overlapped
 * it cannot cache the old button (see `fillIfRowUnchanged`).
 */
import { db, eq, identityProvider } from '@/lib/server/db'
import { bumpAuthConfigVersionInTx } from '@/lib/server/auth/config-version'
import type { IdentityProviderId } from '@quackback/ids'
import { deleteObject } from '@/lib/server/storage/s3'
import { logger } from '@/lib/server/logger'
import { ValidationError } from '@/lib/shared/errors'
import { invalidateSettingsCache, wrapDbError } from './settings.helpers'

const log = logger.child({ component: 'identity-provider-logo' })

async function loadLogoKey(id: IdentityProviderId): Promise<string | null> {
  const [row] = await db
    .select({ logoKey: identityProvider.logoKey })
    .from(identityProvider)
    .where(eq(identityProvider.id, id))
  if (!row) {
    throw new ValidationError('IDP_NOT_FOUND', 'Identity provider not found.')
  }
  return row.logoKey
}

/** Store the uploaded logo's S3 key, deleting the previous object if any. */
export async function saveIdentityProviderLogoKey(
  id: IdentityProviderId,
  key: string
): Promise<{ success: true; key: string }> {
  log.info({ id }, 'save identity provider logo key')
  try {
    const previous = await loadLogoKey(id)
    if (previous && previous !== key) {
      try {
        await deleteObject(previous)
      } catch (err) {
        log.warn({ err, logo_key: previous }, 'failed to delete old idp logo s3 object')
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(identityProvider).set({ logoKey: key }).where(eq(identityProvider.id, id))
      await bumpAuthConfigVersionInTx(tx)
    })
    await invalidateSettingsCache()
    return { success: true, key }
  } catch (error) {
    log.error({ err: error }, 'save identity provider logo key failed')
    wrapDbError('save identity provider logo key', error)
  }
}

/** Clear the logo: delete the S3 object and null the key. */
export async function deleteIdentityProviderLogoKey(
  id: IdentityProviderId
): Promise<{ success: true }> {
  log.info({ id }, 'delete identity provider logo key')
  try {
    const previous = await loadLogoKey(id)
    if (previous) {
      try {
        await deleteObject(previous)
      } catch (err) {
        log.warn({ err, logo_key: previous }, 'failed to delete idp logo s3 object')
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(identityProvider).set({ logoKey: null }).where(eq(identityProvider.id, id))
      await bumpAuthConfigVersionInTx(tx)
    })
    await invalidateSettingsCache()
    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'delete identity provider logo key failed')
    wrapDbError('delete identity provider logo key', error)
  }
}
