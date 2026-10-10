/**
 * User resolution for CSV import.
 *
 * Resolves CSV authors to principal IDs, creating new user+principal
 * records when needed. Email is the identity when present; a name with
 * no email creates a name-only portal contact (same shape as
 * createPortalUser). Rows with neither are rejected — the importer is
 * never used as the author.
 *
 * Adapted from scripts/import/core/user-resolver.ts for
 * use within the in-app CSV import flow.
 */

import { db, eq, and, isNull, sql, asc, user, principal } from '@/lib/server/db'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createPrincipals } from '@/lib/server/domains/principals/principal.factory'

interface PendingUser {
  principalId: PrincipalId
  userId: UserId
  email: string | null
  name: string
  emailVerified: boolean
}

function nameCacheKey(name: string): string {
  return `name:${name.toLowerCase()}`
}

/**
 * Resolves CSV authors to principal IDs.
 *
 * - Caches lookups per instance (create once per import job)
 * - Batches user+principal creation via flushPendingCreates()
 * - Case-insensitive email matching; case-insensitive name matching for
 *   name-only contacts (never matches an identified user by display name)
 */
export class ImportUserResolver {
  private cache = new Map<string, PrincipalId>()
  private pendingCreates: PendingUser[] = []

  /**
   * Resolve a CSV author to a principal ID.
   *
   * Email present: existing user+principal by email, else queue a new
   * claimable shell (`emailVerified` applies only to that create).
   * Email empty, name present: existing name-only contact by display
   * name, else queue a name-only portal person.
   * Both empty: throws — CSV rows without an author are rejected at
   * schema validation; callers that might see an empty identity (voters)
   * must skip before calling this.
   *
   * `emailVerified` applies only when THIS call queues an email create
   * (default true: import shells must be claimable via SSO). Existing
   * users (and already-queued creates) are never flipped. Name-only
   * creates are always unverified — there is no address to vouch for.
   */
  async resolve(
    email: string | null | undefined,
    name: string | null | undefined,
    emailVerified = true
  ): Promise<PrincipalId> {
    const normalizedEmail = email?.toLowerCase().trim() ?? ''
    if (normalizedEmail) {
      return this.resolveByEmail(normalizedEmail, name, emailVerified)
    }

    const trimmedName = name?.trim() ?? ''
    if (trimmedName) {
      return this.resolveByName(trimmedName)
    }

    throw new Error('Import author requires a name or email')
  }

  private async resolveByEmail(
    normalizedEmail: string,
    name: string | null | undefined,
    emailVerified: boolean
  ): Promise<PrincipalId> {
    if (this.cache.has(normalizedEmail)) {
      return this.cache.get(normalizedEmail)!
    }

    const existing = await db
      .select({ principalId: principal.id })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    if (existing.length > 0) {
      const principalId = existing[0].principalId as PrincipalId
      this.cache.set(normalizedEmail, principalId)
      return principalId
    }

    const userId = createId('user')
    const principalId = createId('principal')
    const displayName = name?.trim() || normalizedEmail.split('@')[0]

    this.pendingCreates.push({
      principalId,
      userId,
      email: normalizedEmail,
      name: displayName,
      emailVerified,
    })
    this.cache.set(normalizedEmail, principalId)
    return principalId
  }

  private async resolveByName(trimmedName: string): Promise<PrincipalId> {
    const cacheKey = nameCacheKey(trimmedName)
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    const existing = await db
      .select({ principalId: principal.id })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(
        and(isNull(user.email), sql`lower(${principal.displayName}) = ${trimmedName.toLowerCase()}`)
      )
      .orderBy(asc(principal.createdAt))
      .limit(1)

    if (existing.length > 0) {
      const principalId = existing[0].principalId as PrincipalId
      this.cache.set(cacheKey, principalId)
      return principalId
    }

    const userId = createId('user')
    const principalId = createId('principal')
    this.pendingCreates.push({
      principalId,
      userId,
      email: null,
      name: trimmedName,
      emailVerified: false,
    })
    this.cache.set(cacheKey, principalId)
    return principalId
  }

  /**
   * Flush all pending user+member creations to the database.
   * Call this once per batch after all resolves are done.
   */
  async flushPendingCreates(): Promise<number> {
    if (this.pendingCreates.length === 0) return 0

    const toCreate = [...this.pendingCreates]
    this.pendingCreates = []

    const chunkSize = 100
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      const chunk = toCreate.slice(i, i + chunkSize)

      // Create user records
      await db.insert(user).values(
        chunk.map((u) => ({
          id: u.userId,
          email: u.email,
          name: u.name,
          emailVerified: u.emailVerified,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )

      // Create principal records (single multi-row insert, no N+1)
      await createPrincipals(
        chunk.map((u) => ({
          id: u.principalId,
          userId: u.userId,
          role: 'user' as const,
          displayName: u.name,
        }))
      )
    }

    return toCreate.length
  }

  get pendingCount(): number {
    return this.pendingCreates.length
  }
}
