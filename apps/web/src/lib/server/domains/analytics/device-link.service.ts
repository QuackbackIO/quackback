/**
 * Durable-device identity linkage (visitor analytics layer 2).
 *
 * A device row tracks first/last seen; the principal soft link is set when
 * the device engages (widget identify or anonymous mint) and re-pointed by
 * mergeAnonymousToIdentified when a lead signs in. Linking also carries the
 * device's prior anonymous page-views onto the principal, which is what
 * makes the Visitor -> Lead -> User funnel lossless.
 */
import { db, sql, and, eq, isNull, pageViews, visitorDevices } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

/** Beacon-path upsert: keep the device row's recency fields fresh. */
export async function touchVisitorDevice(deviceId: string, country: string | null): Promise<void> {
  await db
    .insert(visitorDevices)
    .values({ deviceId, lastCountry: country })
    .onConflictDoUpdate({
      target: visitorDevices.deviceId,
      set: {
        lastSeenAt: new Date(),
        lastCountry: sql`coalesce(excluded.last_country, ${visitorDevices.lastCountry})`,
      },
    })
}

/**
 * Record device -> principal and attribute the device's unclaimed page-views
 * to that principal. Re-linking to a different principal is allowed (a shared
 * browser identifying as someone else); already-attributed rows keep their
 * original principal.
 */
export async function linkDeviceToPrincipal(
  deviceId: string,
  principalId: PrincipalId
): Promise<void> {
  await db
    .insert(visitorDevices)
    .values({ deviceId, principalId })
    .onConflictDoUpdate({
      target: visitorDevices.deviceId,
      set: { principalId, lastSeenAt: new Date() },
    })
  await db
    .update(pageViews)
    .set({ principalId })
    .where(and(eq(pageViews.deviceId, deviceId), isNull(pageViews.principalId)))
}
