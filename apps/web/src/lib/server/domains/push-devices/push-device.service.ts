import { db, pushDevices, eq, and } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

export type PushPlatform = 'ios' | 'android'

/**
 * Register (or refresh) a push device for an agent. Idempotent on `token`:
 * re-registering the same token re-points it to the current principal and
 * bumps `lastSeenAt`, so a device handed to another agent can't keep an old
 * owner.
 *
 * The re-bind on conflict is intentional (shared support-device reassignment).
 * It is NOT a hijack vector: the FCM/APNs token is a device-held secret only
 * obtainable on the registering device, so a caller cannot register a token
 * they don't physically possess.
 */
export async function registerDevice(input: {
  principalId: PrincipalId
  token: string
  platform: PushPlatform
}): Promise<void> {
  await db
    .insert(pushDevices)
    .values({
      principalId: input.principalId,
      token: input.token,
      platform: input.platform,
    })
    .onConflictDoUpdate({
      target: pushDevices.token,
      set: {
        principalId: input.principalId,
        platform: input.platform,
        lastSeenAt: new Date(),
      },
    })
}

/**
 * Remove a device (logout / token rotation). Scoped to the owning principal so
 * an authenticated caller can only delete their OWN device rows — never another
 * agent's by token alone (IDOR guard). Safe if absent.
 */
export async function unregisterDevice(input: {
  principalId: PrincipalId
  token: string
}): Promise<void> {
  await db
    .delete(pushDevices)
    .where(and(eq(pushDevices.token, input.token), eq(pushDevices.principalId, input.principalId)))
}
